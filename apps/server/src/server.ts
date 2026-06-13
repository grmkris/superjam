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
  nullOnchain,
} from "@superjam/api";
import { createDb, runMigrations } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import { SERVICE_URLS } from "@superjam/shared";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createS3Store } from "./bucket.ts";
import { env } from "./env.ts";
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
// configured). Unlink stays degraded until its transport is wired (§23).
const onchain =
  createOnchainFromConfig({
    serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
    baseSepoliaRpcUrl: env.BASE_SEPOLIA_RPC_URL,
    arcRpcUrl: env.ARC_RPC_URL,
    unlink: { apiKey: env.UNLINK_API_KEY, appId: env.UNLINK_APP_ID },
  }) ?? nullOnchain;
const treasuryAddress = env.TREASURY_ADDRESS as `0x${string}` | undefined;

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
