// SuperJam server (§6/§12): Hono + oRPC over /rpc/*, health, identity JWKS
// (added M3). Migrations run on boot (§18). The deployed image ships no Claude
// CLI — agent builds dispatch to the dev-box builder (§11).
import { serve } from "@hono/node-server";
import {
  type ApiContext,
  appRouter,
  createAppTokenIssuer,
  createContext,
  createDynamicVerifier,
  createOnchainFromConfig,
  createRateLimiter,
  createWorldVerifier,
  loadLiveUnlinkTransport,
  nullOnchain,
  resolveUserFromPat,
} from "@superjam/api";
import { createDb, runMigrations, schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import {
  OnchainError,
  PUBLIC_CHAIN,
  type UnlinkSdk,
  createArcX402Signer,
} from "@superjam/onchain";
import { SERVICE_URLS } from "@superjam/shared";
import { eq } from "drizzle-orm";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createS3Store } from "./bucket.ts";
import { createDelegatedUnlinkService } from "./delegated-signer.ts";
import {
  loadDelegationCreds,
  registerDelegationWebhook,
} from "./delegation-webhook.ts";
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
// This wallet signs the single money chain (PUBLIC_CHAIN = Arc). Any failure
// degrades to the raw-key path so boot never breaks. (Identity — ENSv2 + ERC-8004
// — is on Sepolia L1 with its own dedicated signer; see ensV2/ensV2SignerKey.)
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
    logger.error(
      { err: String(err) },
      "Dynamic server wallet init failed — falling back to raw key",
    );
    dynServerWallet = undefined;
  }
}
// Per-user private-payments rail (§23): the server signs AS the user via Dynamic
// delegated access (no per-tx popup). Live only when the delegation private key +
// Unlink key + Dynamic env are all present; else createContext defaults to
// nullUnlinkService (private payments return CHAIN_UNAVAILABLE until configured).
const unlink =
  dynEnv && env.DYNAMIC_DELEGATION_PRIVATE_KEY && env.UNLINK_API_KEY
    ? createDelegatedUnlinkService({
        environmentId: env.DYNAMIC_ENVIRONMENT_ID,
        dynamicApiKey: dynEnv.authToken,
        unlinkApiKey: env.UNLINK_API_KEY,
        rpcUrl: env.ARC_RPC_URL,
        faucetKey: env.ARC_PAYER_EOA_KEY,
        loadCreds: (userId) => loadDelegationCreds(db, userId),
      })
    : undefined;

// The Circle Gateway leg (§3/§23) — the private→x402 transport that lights up
// `onchain.unlink.payX402` (consumed by builds.payBuildFee). GATED: live only when
// the server wallet (the x402 signer), the per-user Unlink service, AND the Circle
// key are all present; otherwise null ⇒ payX402 degrades to PAYMENT_REQUIRED and
// nothing else is affected (the cut-first posture). The `UnlinkSdk` adapter bridges
// the transport's address-keyed ops to the per-user service: it resolves
// `fromUnlinkAddress → userId` and unshields to the SERVER WALLET, whose Circle
// Gateway escrow then settles the agent's x402 resource (the private→public→x402 leg).
const unlinkTransport = (() => {
  if (!dynServerWallet?.account || !unlink) return loadLiveUnlinkTransport(env);
  const signer = createArcX402Signer(dynServerWallet.account, env.ARC_RPC_URL);
  const serverWalletAddress = dynServerWallet.address;
  const userIdFor = async (unlinkAddress: string): Promise<string> => {
    const row = await db.query.user.findFirst({
      columns: { id: true },
      where: eq(schema.user.unlinkAddress, unlinkAddress),
    });
    if (!row) {
      throw new OnchainError(
        "CHAIN_UNAVAILABLE",
        "No SuperJam user owns that shielded account",
      );
    }
    return row.id;
  };
  const adapter: UnlinkSdk = {
    privateTransfer: async ({ fromUnlinkAddress, toUnlinkAddress, amount }) => ({
      hash: await unlink.transfer(
        await userIdFor(fromUnlinkAddress),
        toUnlinkAddress,
        amount,
      ),
    }),
    faucetPrivateTokens: async ({ toUnlinkAddress, amount }) => ({
      hash: await unlink.faucet(toUnlinkAddress, amount),
    }),
    withdraw: async ({ fromUnlinkAddress, amount }) => ({
      hash: await unlink.withdraw(
        await userIdFor(fromUnlinkAddress),
        serverWalletAddress,
        amount,
      ),
    }),
  };
  return loadLiveUnlinkTransport(env, { signer, unlink: adapter });
})();

const onchain =
  createOnchainFromConfig({
    serverWallet: dynServerWallet,
    serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
    arcRpcUrl: env.ARC_RPC_URL,
    unlink: {
      apiKey: env.UNLINK_API_KEY,
      appId: env.UNLINK_APP_ID,
      ...(unlinkTransport
        ? { transport: unlinkTransport, gatewayConfigured: true }
        : {}),
    },
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
    // StakeSlash yield-escrow on Arc (Circle #1) — agent stakes earn yield. Absent
    // ⇒ onchain.stakeSlash is null and staking degrades (never blocks a register).
    stakeSlashAddress: env.STAKE_SLASH_ADDRESS,
    // World AgentBook (World prize) — read-only human-backed detection on World Chain.
    // Both default (canonical contract + public RPC), so this works with no env set.
    worldchainRpcUrl: env.WORLDCHAIN_RPC_URL,
    agentBookAddress: env.AGENTBOOK_ADDRESS,
  }) ?? nullOnchain;
// World ID 4.0 backend verifier (§14) — the human gate behind publish/reviews/
// register-builder. Keyless (rpContext/verify reject) unless app_id + rp_id +
// signing key are all set. WORLD_ENVIRONMENT=staging runs against the simulator.
const world = createWorldVerifier({
  appId: env.WORLD_APP_ID,
  rpId: env.WORLD_RP_ID,
  signingKeyHex: env.WORLD_RP_SIGNING_KEY,
  action: env.WORLD_ACTION,
  environment: env.WORLD_ENVIRONMENT,
});
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

// Object store (S3): backs attachment uploads + presigned-GET delivery to the
// builder agent. (Track-A /a bundle serving removed 2026-06-14 — apps are external,
// framed by app.entryUrl; see docs/PIVOT.md.)
const objectStore = createS3Store(env);

// One request-context factory, shared by /rpc and /mcp (the MCP tools call the
// same oRPC procedures in-process as the bearer's user).
const makeContext = (headers: Headers): ApiContext =>
  createContext({
    db,
    logger,
    auth,
    rateLimiter,
    issuer,
    onchain,
    oracle,
    unlink,
    world,
    objectStore,
    treasuryAddress,
    headers,
  });

// MCP endpoint (§MCP) — external agents (a user's Claude Code) hire builders AS the
// user via a `sjat_…` PAT. Tools run the existing build flow + pay via delegation.
registerMcp(app, { makeContext });

// Dynamic delegation webhook (§23) — receives wallet.delegation.created/revoked,
// decrypts + stores the per-user MPC share so the server can sign privately on the
// user's behalf. Gateway routes /api/* → server. Mounted only when configured.
if (env.DYNAMIC_DELEGATION_PRIVATE_KEY && env.DYNAMIC_WEBHOOK_SECRET) {
  registerDelegationWebhook(app, {
    db,
    logger,
    privateKeyPem: env.DYNAMIC_DELEGATION_PRIVATE_KEY,
    webhookSecret: env.DYNAMIC_WEBHOOK_SECRET,
  });
}

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
