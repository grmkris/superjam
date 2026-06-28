// Boot the builder service on the dev box (kristjan-dev VPS). Parses operator env,
// wires the REAL Vercel + Neon clients + the template generator, and serves. The
// `superjam-builder` systemd unit runs this from the working tree (restart to load
// changes).
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
import { createBuilderApp } from "./app.ts";
import { makeLocalBackend, makeSandboxBackend } from "./backend/index.ts";
import { vercelRemove } from "./cli-deploy.ts";
import { parseBuilderEnv } from "./env.ts";
import { runInMemoryBuild } from "./in-memory-build.ts";
import { createBuildRunner } from "./queue.ts";
import { makeVercelEntryUrlResolver } from "./vercel-alias.ts";

const env = parseBuilderEnv(process.env);
const logger = createLogger({ level: "info" });

// Teardown (app delete) stays platform-side: `vercel rm` + Neon delete by the ids
// the builder reported. The Neon client needs an API key for the SAME account the
// builder provisions under (so it can delete by id).
const teardownVercel: VercelTeardown = (name) =>
  vercelRemove(name, { token: env.VERCEL_TOKEN });
const neon = env.NEON_API_KEY
  ? createNeonClient({ apiKey: env.NEON_API_KEY, regionId: env.NEON_REGION_ID })
  : undefined;

// The in-process builder fills + ships every app: it seeds a skeleton, runs an AI-SDK
// tool loop over a pluggable backend (local host / sandbox), loops `next build` to
// green, then deploys deterministically. It's provider-agnostic — pickModel() builds a
// coding model from whichever API key is configured (Gemini today). NO silent fallback:
// no key ⇒ throw at boot (assume creds present).
const pickModel = (): LanguageModel | null => {
  const provider =
    env.BUILD_PROVIDER !== "auto"
      ? env.BUILD_PROVIDER
      : env.ANTHROPIC_API_KEY
        ? "anthropic"
        : env.GOOGLE_GENERATIVE_AI_API_KEY
          ? "google"
          : null;
  if (provider === "anthropic" && env.ANTHROPIC_API_KEY) {
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
      env.BUILD_MODEL ?? "claude-sonnet-4-6"
    );
  }
  if (provider === "google" && env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(
      // Flash is the default: filling a scaffolded template against the SDK reference
      // with a build-error retry loop is templated coding (Flash's sweet spot) — far
      // cheaper/faster than Pro. Override with BUILD_MODEL for harder specs.
      env.BUILD_MODEL ?? "gemini-2.5-flash"
    );
  }
  return null;
};

const model = pickModel();
if (!model) {
  // No fallback: fail loud rather than booting a builder that can't build.
  throw new Error(
    "In-memory builder requires a model API key (GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY)."
  );
}
const backendFactory =
  env.BUILD_BACKEND === "sandbox" ? makeSandboxBackend : makeLocalBackend;

const runBuild: Parameters<typeof createBuildRunner>[0]["runBuild"] = (a) =>
  runInMemoryBuild(
    { ...a, port: env.PORT, jwksUrl: a.jwksUrl ?? env.SUPERJAM_JWKS_URL },
    {
      backendFactory,
      model,
      vercelToken: env.VERCEL_TOKEN,
      neon,
      googleKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    }
  );

const runner = createBuildRunner({
  runBuild,
  maxConcurrent: env.MAX_CONCURRENT_BUILDS,
  // Record the REAL Vercel production alias — the reported URL is a guess that
  // 404s for long project names (Vercel truncates the auto-alias).
  resolveEntryUrl: makeVercelEntryUrlResolver(env.VERCEL_TOKEN),
});
logger.info(
  { driver: "in-memory", backend: env.BUILD_BACKEND },
  "build driver selected"
);

const app = createBuilderApp({
  token: env.BUILDER_TOKEN,
  runner,
  teardown: (args) => teardownApp(args, { teardownVercel, neon }),
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "builder listening");
});
