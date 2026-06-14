// Boot the builder service on the dev box (kristjan-dev VPS), where `claude` is
// subscription-authed. Parses operator env, wires the REAL Vercel + Neon clients
// + the template generator, and serves. At M5 the `turbojam-builder` systemd
// unit repoints WorkingDirectory/ExecStart here and restarts (SPEC §11 deploy).
import {
  createNeonClient,
  teardownApp,
  type VercelTeardown,
} from "@superjam/builder/deploy";
import { createLogger } from "@superjam/logger";
import { createX402HireResource } from "@superjam/onchain/x402-resource";
import { serve } from "@hono/node-server";
import { runAgentBuild } from "./agent-build.ts";
import { createBuilderApp } from "./app.ts";
import { vercelRemove } from "./cli-deploy.ts";
import { parseBuilderEnv } from "./env.ts";
import { createBuildRunner } from "./queue.ts";
import { makeVercelEntryUrlResolver } from "./vercel-alias.ts";

const env = parseBuilderEnv(process.env);
const logger = createLogger({ level: "info" });

// Teardown (app delete) stays platform-side: `vercel rm` + Neon delete by the ids
// the agent reported. The Neon client needs an API key for the SAME account the
// agent's Neon MCP provisions under (so it can delete by id).
const teardownVercel: VercelTeardown = (name) =>
  vercelRemove(name, { token: env.VERCEL_TOKEN });
const neon = env.NEON_API_KEY
  ? createNeonClient({ apiKey: env.NEON_API_KEY, regionId: env.NEON_REGION_ID })
  : undefined;

// `claude auth status` is the only truthful auth signal — Bun.which lies.
let authCache: { t: number; ok: boolean } | undefined;
const claudeAuth = async (): Promise<boolean> => {
  if (authCache && Date.now() - authCache.t < 60_000) return authCache.ok;
  try {
    const proc = Bun.spawn(["claude", "auth", "status"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    authCache = { t: Date.now(), ok: /"loggedIn":\s*true/.test(out) };
  } catch {
    authCache = { t: Date.now(), ok: false };
  }
  return authCache.ok;
};

// Pure-agentic build: the runner launches the autonomous agent (Bash + the box's
// inherited Neon/Vercel MCPs), which implements + provisions + deploys the app
// itself and POSTs progress/result to the loopback /report callback (port below).
const runner = createBuildRunner({
  runBuild: (a) =>
    runAgentBuild({ ...a, port: env.PORT, jwksUrl: env.SUPERJAM_JWKS_URL }),
  maxConcurrent: env.MAX_CONCURRENT_BUILDS,
  // Record the REAL Vercel production alias — the agent reports a guessed URL
  // that 404s for long project names (Vercel truncates the auto-alias).
  resolveEntryUrl: makeVercelEntryUrlResolver(env.VERCEL_TOKEN),
});

// The x402 "hire" resource (§14): when this builder has a wallet + price set, the
// platform's `payBuildFee` settles the build fee here (Circle Gateway, Arc) before
// dispatching to /builds. Absent the config ⇒ undefined ⇒ POST / answers 501 and
// the paid path degrades cleanly (the box still boots + builds for free flows).
const hire =
  env.AGENT_WALLET_ADDRESS && env.AGENT_PRICE_USDC
    ? createX402HireResource({
        payTo: env.AGENT_WALLET_ADDRESS,
        priceUsdc: env.AGENT_PRICE_USDC,
        circleApiKey: env.CIRCLE_GATEWAY_API_KEY,
        // AgentKit free-trial (World prize) — set AGENT_FREE_TRIAL_USES to enable.
        freeTrialUses: env.AGENT_FREE_TRIAL_USES,
      })
    : undefined;

const app = createBuilderApp({
  token: env.BUILDER_TOKEN,
  runner,
  teardown: (args) => teardownApp(args, { teardownVercel, neon }),
  claudeAuth,
  hire,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "builder listening");
});
