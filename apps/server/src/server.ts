// SuperJam server (§6/§12): Hono + oRPC over /rpc/*, health, identity JWKS
// (added M3). Migrations run on boot (§18). The deployed image ships no Claude
// CLI — agent builds dispatch to the dev-box builder (§11).
import { createHmac, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { decryptDelegatedWebhookData } from "@dynamic-labs-wallet/node";
import {
  type ApiContext,
  appRouter,
  createAppTokenIssuer,
  createContext,
  createDynamicVerifier,
  createOnchainFromConfig,
  createRateLimiter,
  nullOnchain,
  resolveUserFromPat,
} from "@superjam/api";
import { createDb, runMigrations, schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import { PUBLIC_CHAIN } from "@superjam/onchain";
import { SERVICE_URLS } from "@superjam/shared";
import { RPCHandler } from "@orpc/server/fetch";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createS3Store } from "./bucket.ts";
import {
  createDelegatedSigner,
  delegatedSignerEnv,
} from "./delegated-signer.ts";
import {
  createDynamicServerWallet,
  dynamicWalletEnv,
} from "./dynamic-wallet.ts";
import { env } from "./env.ts";
import { PAT_RE, renderInstallScript } from "./install-script.ts";
import { registerMcp } from "./mcp.ts";
import { createGeminiOracle } from "./oracle.ts";

const logger = createLogger({
  name: "server",
  level: env.LOG_LEVEL,
  pretty: env.APP_ENV === "local",
});

const { db } = createDb(env.DATABASE_URL);
await runMigrations(db);
logger.info("migrations applied");

const auth = createDynamicVerifier(env.DYNAMIC_ENVIRONMENT_ID);
const rateLimiter = createRateLimiter();
// Platform identity-token issuer (pivot §1) — keyless unless APP_JWT_* set.
const issuer = await createAppTokenIssuer({
  privateKeyPem: env.APP_JWT_PRIVATE_KEY,
  publicKeyPem: env.APP_JWT_PUBLIC_KEY,
  kid: env.APP_JWT_KID,
  issuer: SERVICE_URLS[env.APP_ENV].web,
});
// Agent signer: a Dynamic TSS-MPC server wallet when configured (Best Agentic
// Build — no raw key), else the funded plain-key fallback. The MPC client auth
// is async, so it's built here at boot and injected as a pre-made ServerWallet.
// This wallet signs the single money chain (PUBLIC_CHAIN = Arc). In prod a failure
// is fatal (no silent raw-key degrade); outside prod it falls back so boot never
// breaks. (Identity — ENSv2 + ERC-8004 — is on Sepolia L1 with its own dedicated
// signer; see ensV2/ensV2SignerKey.)
const dynEnv = dynamicWalletEnv();
let dynServerWallet: Awaited<ReturnType<typeof createDynamicServerWallet>> | undefined;
if (dynEnv) {
  try {
    dynServerWallet = await createDynamicServerWallet(
      dynEnv,
      PUBLIC_CHAIN,
      env.ARC_RPC_URL,
    );
    logger.info(
      { signer: dynServerWallet.address },
      "agent signer: Dynamic TSS-MPC server wallet",
    );
  } catch (err) {
    // In prod a misconfigured MPC wallet must NOT silently degrade to the raw key
    // (you'd believe MPC is signing when it isn't) — fail fast so it's caught at
    // boot. Outside prod, fall back so local/dev rehearsal never breaks.
    logger.error({ err: String(err) }, "Dynamic server wallet init failed");
    if (env.APP_ENV === "prod") throw err;
    logger.warn("falling back to raw-key signer (non-prod)");
    dynServerWallet = undefined;
  }
}
const onchain =
  createOnchainFromConfig({
    serverWallet: dynServerWallet,
    serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
    arcRpcUrl: env.ARC_RPC_URL,
    // ERC-8004 (§14/§16): the canonical reference IdentityRegistry, set via
    // ERC8004_REGISTRY (Base Sepolia). ReputationRegistry defaults to the paired
    // canonical address in the binding. Absent ⇒ 8004 ops degrade (never fail).
    erc8004: env.ERC8004_REGISTRY
      ? { identityRegistry: env.ERC8004_REGISTRY as `0x${string}` }
      : undefined,
    // ENSv2-native (§16) — the SINGLE naming path: mints `<label>.superjam.eth`
    // resolvable in standard ENS tooling (Sepolia L1 SuperjamRegistry, agent-owned,
    // own dedicated signer). Absent ⇒ the v2 mint degrades (never fails a build).
    ensV2:
      env.ENS_V2_REGISTRY && env.SEPOLIA_RPC_URL && env.ENS_V2_SIGNER_KEY
        ? { registry: env.ENS_V2_REGISTRY as `0x${string}` }
        : undefined,
    sepoliaRpcUrl: env.SEPOLIA_RPC_URL,
    ensV2SignerKey: env.ENS_V2_SIGNER_KEY,
    // World AgentBook (World prize) — read-only human-backed detection on World Chain.
    // Both default (canonical contract + public RPC), so this works with no env set.
    worldchainRpcUrl: env.WORLDCHAIN_RPC_URL,
    agentBookAddress: env.AGENTBOOK_ADDRESS,
  }) ?? nullOnchain;
const treasuryAddress = env.TREASURY_ADDRESS as `0x${string}` | undefined;
// AI pot-resolution oracle (§9) — only when a Gemini key is present; else
// nullOracle (creators resolve with an explicit outcome).
const oracle = env.GOOGLE_GENERATIVE_AI_API_KEY
  ? createGeminiOracle()
  : undefined;

const rpc = new RPCHandler(appRouter);

const app = new Hono();

app.use(
  "/rpc/*",
  cors({
    origin: [SERVICE_URLS.local.web, SERVICE_URLS.dev.web, SERVICE_URLS.prod.web],
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

app.get("/health", (c) => c.text("OK"));

// `curl …/install.sh?token=sjat_… | bash` (§MCP onboarding) — emits the installer
// that registers the SuperJam MCP (Bearer PAT) + drops the usage skill into the
// caller's Claude Code. The token is interpolated into bash, so we validate its
// exact shape AND that it resolves to a live user before emitting anything.
app.get("/install.sh", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!PAT_RE.test(token)) {
    return c.text("# Invalid or missing token.\nexit 1\n", 400, {
      "content-type": "text/x-shellscript; charset=utf-8",
    });
  }
  const user = await resolveUserFromPat(db, token);
  if (!user) {
    return c.text("# Unknown or expired token — re-issue from SuperJam.\nexit 1\n", 401, {
      "content-type": "text/x-shellscript; charset=utf-8",
    });
  }
  const mcpUrl = `${SERVICE_URLS[env.APP_ENV].web}/mcp`;
  c.header("content-type", "text/x-shellscript; charset=utf-8");
  c.header("cache-control", "no-store");
  return c.body(renderInstallScript(token, mcpUrl));
});

// Public key set external app backends verify our identity tokens against (§1).
app.get("/.well-known/jwks.json", (c) => {
  c.header("cache-control", "public, max-age=300");
  c.header("access-control-allow-origin", "*");
  return c.json(issuer.jwks());
});

// Dynamic Delegated Access webhook (§23). On user approval Dynamic POSTs
// `wallet.delegation.created` with encrypted key shares; on revoke,
// `wallet.delegation.revoked`. We verify the HMAC over the RAW body, decrypt with
// the RSA private key, and store/remove the user's delegation. Raw route (not oRPC)
// so we hash the exact bytes received.
app.post("/api/webhooks/dynamic/delegation", async (c) => {
  const secret = env.DYNAMIC_WEBHOOK_SECRET;
  const rsaPem = env.DYNAMIC_DELEGATION_PRIVATE_KEY;
  if (!secret || !rsaPem) {
    logger.warn("delegation webhook hit but DYNAMIC_DELEGATION_* not configured");
    return c.json({ error: "delegation not configured" }, 503);
  }

  const raw = await c.req.text();
  const sigHeader = c.req.header("x-dynamic-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const got = Buffer.from(sigHeader);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return c.json({ error: "invalid signature" }, 401);
  }

  let body: {
    eventName?: string;
    userId?: string;
    environmentId?: string;
    data?: {
      userId?: string;
      walletId?: string;
      publicKey?: string;
      shareSetId?: string;
      encryptedDelegatedShare?: unknown;
      encryptedWalletApiKey?: unknown;
    };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "bad json" }, 400);
  }

  // Defense-in-depth: the HMAC secret is already environment-scoped, but reject a
  // misrouted webhook for a different Dynamic environment outright.
  if (body.environmentId && body.environmentId !== env.DYNAMIC_ENVIRONMENT_ID) {
    logger.warn(
      { got: body.environmentId },
      "delegation webhook for a different environment — ignoring",
    );
    return c.json({ error: "wrong environment" }, 400);
  }

  const { userDelegation } = schema;
  try {
    if (body.eventName === "wallet.delegation.created") {
      const data = body.data ?? {};
      const dynamicUserId = body.userId ?? data.userId;
      if (!dynamicUserId || !data.walletId || !data.publicKey) {
        return c.json({ error: "missing fields" }, 400);
      }
      const owner = await db.query.user.findFirst({
        columns: { id: true },
        where: eq(schema.user.dynamicUserId, dynamicUserId),
      });
      if (!owner) {
        // Ack so Dynamic stops retrying; nothing to attach to.
        logger.warn({ dynamicUserId }, "delegation.created for unknown user");
        return c.json({ ok: true });
      }
      // The encrypted blobs are EncryptedDelegatedPayload at runtime; the webhook
      // body is untyped JSON, so cast across into the SDK helper.
      const { decryptedDelegatedShare, decryptedWalletApiKey } =
        decryptDelegatedWebhookData({
          privateKeyPem: rsaPem,
          encryptedDelegatedKeyShare: data.encryptedDelegatedShare as never,
          encryptedWalletApiKey: data.encryptedWalletApiKey as never,
        });
      const values = {
        userId: owner.id,
        dynamicUserId,
        walletId: data.walletId,
        address: data.publicKey,
        shareSetId: data.shareSetId ?? null,
        walletApiKey: decryptedWalletApiKey,
        keyShare: decryptedDelegatedShare,
      };
      await db
        .insert(userDelegation)
        .values(values)
        .onConflictDoUpdate({
          target: userDelegation.userId,
          set: {
            dynamicUserId: values.dynamicUserId,
            walletId: values.walletId,
            address: values.address,
            shareSetId: values.shareSetId,
            walletApiKey: values.walletApiKey,
            keyShare: values.keyShare,
          },
        });
      logger.info({ userId: owner.id }, "delegation stored");
    } else if (body.eventName === "wallet.delegation.revoked") {
      const dynamicUserId = body.userId ?? body.data?.userId;
      if (dynamicUserId) {
        await db
          .delete(userDelegation)
          .where(eq(userDelegation.dynamicUserId, dynamicUserId));
        logger.info({ dynamicUserId }, "delegation revoked");
      }
    }
  } catch (err) {
    logger.error({ err: String(err) }, "delegation webhook processing failed");
    return c.json({ error: "processing failed" }, 500);
  }
  return c.json({ ok: true });
});

// Object store (S3): backs attachment uploads + presigned-GET delivery to the
// builder agent. (Track-A /a bundle serving removed 2026-06-14 — apps are external,
// framed by app.entryUrl; see docs/PIVOT.md.)
const objectStore = createS3Store(env);

// One request-context factory, shared by /rpc and /mcp (the MCP tools call the
// same oRPC procedures in-process as the bearer's user).
// Delegated signer (Dynamic Delegated Access, §23) — server signs AS the user via
// their approved key share (server-side payments + MCP act-as-user). Built once at
// boot; absent (env unset) ⇒ delegated-pay paths reject with a clear "delegate first".
const delEnv = delegatedSignerEnv();
const delegatedSigner = delEnv
  ? createDelegatedSigner(delEnv, db)
  : undefined;
logger.info(
  { enabled: Boolean(delegatedSigner) },
  "delegated signer (Dynamic Delegated Access)",
);

const makeContext = (headers: Headers): ApiContext =>
  createContext({
    db,
    logger,
    auth,
    rateLimiter,
    issuer,
    onchain,
    oracle,
    objectStore,
    treasuryAddress,
    delegatedSigner,
    headers,
  });

// MCP endpoint (§MCP) — external agents (a user's Claude Code) hire builders AS the
// user via a `sjat_…` PAT. Tools run the existing (free) build flow in-process.
registerMcp(app, { makeContext });

app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/rpc",
    context: makeContext(c.req.raw.headers),
  });
  if (matched && response) {
    return response;
  }
  await next();
});

const port = process.env.PORT ? Number(process.env.PORT) : 4701;
serve({ fetch: app.fetch, port, hostname: "::" });
logger.info({ port }, "server listening");
