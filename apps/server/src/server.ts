// SuperJam server (§6/§12): Hono + oRPC over /rpc/*, health, bundle serving
// (added M3). Migrations run on boot (§18). The deployed image ships no Claude
// CLI — agent builds dispatch to the dev-box builder (§11).
import { serve } from "@hono/node-server";
import {
  appRouter,
  createAppTokenIssuer,
  createContext,
  createDynamicVerifier,
  createOnchainFromConfig,
  createRateLimiter,
  createWorldVerifier,
  loadLiveUnlinkTransport,
  nullOnchain,
} from "@superjam/api";
import { createDb, runMigrations } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import { PUBLIC_CHAIN } from "@superjam/onchain";
import { SERVICE_URLS } from "@superjam/shared";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createS3Store } from "./bucket.ts";
import {
  createDynamicServerWallet,
  dynamicWalletEnv,
} from "./dynamic-wallet.ts";
import { env } from "./env.ts";
import { createGeminiOracle } from "./oracle.ts";
import { registerServeRoutes } from "./serve.ts";

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
// The chain adapter (§15/§16) — the single reused server-wallet signer. No
// signer key ⇒ nullOnchain (boot stays green; payments return INTERNAL until
// configured). Unlink stays degraded until its transport is wired (§23): the
// live transport (Unlink withdraw → Circle Gateway pay) is null until the
// rehearsal fills the SDK shapes, so payX402 degrades to PAYMENT_REQUIRED while
// private tips/faucet are unaffected. A non-null transport ⇒ the Gateway leg is on.
const unlinkTransport = loadLiveUnlinkTransport(env);
// Agent signer: a Dynamic TSS-MPC server wallet when configured (Best Agentic
// Build — no raw key), else the funded plain-key fallback. The MPC client auth
// is async, so it's built here at boot and injected as a pre-made ServerWallet.
// The same wallet signs the public rail (PUBLIC_CHAIN) and ENS mints (Base
// Sepolia). Any failure degrades to the raw-key path so boot never breaks.
const dynEnv = dynamicWalletEnv();
let dynServerWallet: Awaited<ReturnType<typeof createDynamicServerWallet>> | undefined;
let dynEnsWallet: typeof dynServerWallet;
if (dynEnv) {
  try {
    dynServerWallet = await createDynamicServerWallet(
      dynEnv,
      PUBLIC_CHAIN,
      PUBLIC_CHAIN === "arcTestnet" ? env.ARC_RPC_URL : env.BASE_SEPOLIA_RPC_URL,
    );
    dynEnsWallet = await createDynamicServerWallet(
      dynEnv,
      "baseSepolia",
      env.BASE_SEPOLIA_RPC_URL,
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
    dynEnsWallet = undefined;
  }
}
const onchain =
  createOnchainFromConfig({
    serverWallet: dynServerWallet,
    ensWallet: dynEnsWallet,
    serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
    baseSepoliaRpcUrl: env.BASE_SEPOLIA_RPC_URL,
    arcRpcUrl: env.ARC_RPC_URL,
    unlink: {
      apiKey: env.UNLINK_API_KEY,
      appId: env.UNLINK_APP_ID,
      ...(unlinkTransport
        ? { transport: unlinkTransport, gatewayConfigured: true }
        : {}),
    },
    ens:
      env.ENS_L2_REGISTRY && env.ENS_PARENT_NODE
        ? {
            registryAddress: env.ENS_L2_REGISTRY as `0x${string}`,
            parentNode: env.ENS_PARENT_NODE as `0x${string}`,
            parentName: "superjam.eth", // §16 ship path (Sepolia parent)
          }
        : undefined,
    // ERC-8004 (§14/§16): the canonical reference IdentityRegistry, set via
    // ERC8004_REGISTRY (Base Sepolia). ReputationRegistry defaults to the paired
    // canonical address in the binding. Absent ⇒ 8004 ops degrade (never fail).
    erc8004: env.ERC8004_REGISTRY
      ? { identityRegistry: env.ERC8004_REGISTRY as `0x${string}` }
      : undefined,
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

// Public key set external app backends verify our identity tokens against (§1).
app.get("/.well-known/jwks.json", (c) => {
  c.header("cache-control", "public, max-age=300");
  c.header("access-control-allow-origin", "*");
  return c.json(issuer.jwks());
});

// Bundle serving (§17): /a/:slug/* from S3 with the _plays bump.
registerServeRoutes(app, { db, store: createS3Store(env), logger });

app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/rpc",
    context: createContext({
      db,
      logger,
      auth,
      rateLimiter,
      issuer,
      onchain,
      oracle,
      world,
      treasuryAddress,
      headers: c.req.raw.headers,
    }),
  });
  if (matched && response) {
    return response;
  }
  await next();
});

const port = process.env.PORT ? Number(process.env.PORT) : 4701;
serve({ fetch: app.fetch, port, hostname: "::" });
logger.info({ port }, "server listening");
