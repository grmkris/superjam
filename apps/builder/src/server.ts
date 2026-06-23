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
import { serve } from "@hono/node-server";
import { runAgentBuild } from "./agent-build.ts";
import { createBuilderApp } from "./app.ts";
import { makeLocalBackend, makeSandboxBackend } from "./backend/index.ts";
import { vercelRemove } from "./cli-deploy.ts";
import { parseBuilderEnv } from "./env.ts";
import { runHarnessBuild } from "./harness-build.ts";
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

// Pick the build DRIVER. Both seed the same skeleton and report to the same loopback
// /report callback; they differ only in HOW they fill + ship the app:
//   agent   — the free-roaming Claude Agent SDK (subscription `claude` on the box).
//   harness — an in-process AI-SDK tool loop over a pluggable backend (local host /
//             sandbox), which loops `next build` to green then deploys deterministically.
// harness needs an Anthropic API key; without one we fall back to the proven agent path.
const harnessReady = env.BUILD_DRIVER === "harness" && !!env.ANTHROPIC_API_KEY;
if (env.BUILD_DRIVER === "harness" && !harnessReady) {
  logger.warn("BUILD_DRIVER=harness but ANTHROPIC_API_KEY is unset — using the agent driver");
}
const backendFactory =
  env.BUILD_BACKEND === "sandbox" ? makeSandboxBackend : makeLocalBackend;

const runBuild: Parameters<typeof createBuildRunner>[0]["runBuild"] = harnessReady
  ? (a) =>
      runHarnessBuild(
        { ...a, port: env.PORT, jwksUrl: env.SUPERJAM_JWKS_URL },
        {
          backendFactory,
          apiKey: env.ANTHROPIC_API_KEY as string,
          model: env.HARNESS_MODEL,
          vercelToken: env.VERCEL_TOKEN,
          neon,
          googleKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
        }
      )
  : (a) => runAgentBuild({ ...a, port: env.PORT, jwksUrl: env.SUPERJAM_JWKS_URL });

const runner = createBuildRunner({
  runBuild,
  maxConcurrent: env.MAX_CONCURRENT_BUILDS,
  // Record the REAL Vercel production alias — the reported URL is a guess that
  // 404s for long project names (Vercel truncates the auto-alias).
  resolveEntryUrl: makeVercelEntryUrlResolver(env.VERCEL_TOKEN),
});
logger.info(
  { driver: harnessReady ? "harness" : "agent", backend: env.BUILD_BACKEND },
  "build driver selected"
);

const app = createBuilderApp({
  token: env.BUILDER_TOKEN,
  runner,
  teardown: (args) => teardownApp(args, { teardownVercel, neon }),
  claudeAuth,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "builder listening");
});
