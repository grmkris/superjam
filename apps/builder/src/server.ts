// Boot the builder service on the dev box (kristjan-dev VPS), where `claude` is
// subscription-authed. Parses operator env, wires the REAL Vercel + Neon clients
// + the template generator, and serves. At M5 the `turbojam-builder` systemd
// unit repoints WorkingDirectory/ExecStart here and restarts (SPEC §11 deploy).
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  createNeonClient,
  teardownApp,
  type VercelTeardown,
} from "@superjam/builder/deploy";
import type { LanguageModel } from "ai";
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
// The harness is provider-agnostic: pickModel() builds a coding model from whichever
// API key is configured (Gemini today). NO silent fallback — BUILD_DRIVER=harness with
// no key throws at boot (assume creds present); use BUILD_DRIVER=agent to pick the agent.
const pickModel = (): LanguageModel | null => {
  const provider =
    env.HARNESS_PROVIDER !== "auto"
      ? env.HARNESS_PROVIDER
      : env.ANTHROPIC_API_KEY
        ? "anthropic"
        : env.GOOGLE_GENERATIVE_AI_API_KEY
          ? "google"
          : null;
  if (provider === "anthropic" && env.ANTHROPIC_API_KEY) {
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
      env.HARNESS_MODEL ?? "claude-sonnet-4-6"
    );
  }
  if (provider === "google" && env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(
      // Flash is the default: filling a scaffolded template against the SDK reference
      // with a build-error retry loop is templated coding (Flash's sweet spot) — far
      // cheaper/faster than Pro. Override with HARNESS_MODEL for harder specs.
      env.HARNESS_MODEL ?? "gemini-2.5-flash"
    );
  }
  return null;
};

const harnessModel = env.BUILD_DRIVER === "harness" ? pickModel() : null;
if (env.BUILD_DRIVER === "harness" && !harnessModel) {
  // No fallback: fail loud rather than silently running the wrong (agent) driver.
  throw new Error(
    "BUILD_DRIVER=harness requires a model API key (GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY). Set one, or use BUILD_DRIVER=agent."
  );
}
const backendFactory =
  env.BUILD_BACKEND === "sandbox" ? makeSandboxBackend : makeLocalBackend;

const runBuild: Parameters<typeof createBuildRunner>[0]["runBuild"] = harnessModel
  ? (a) =>
      runHarnessBuild(
        { ...a, port: env.PORT, jwksUrl: env.SUPERJAM_JWKS_URL },
        {
          backendFactory,
          model: harnessModel,
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
  { driver: harnessModel ? "harness" : "agent", backend: env.BUILD_BACKEND },
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
