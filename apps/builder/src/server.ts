// Boot the builder service on the dev box (kristjan-dev VPS), where `claude` is
// subscription-authed. Parses operator env, wires the REAL Vercel + Neon clients
// + the template generator, and serves. At M5 the `turbojam-builder` systemd
// unit repoints WorkingDirectory/ExecStart here and restarts (SPEC §11 deploy).
import {
  createNeonClient,
  type DeployPort,
  teardownApp,
  type VercelTeardown,
} from "@superjam/builder/deploy";
import { createLogger } from "@superjam/logger";
import { serve } from "@hono/node-server";
import { createBuilderApp } from "./app.ts";
import { cliDeploy, vercelRemove } from "./cli-deploy.ts";
import { parseBuilderEnv } from "./env.ts";
import { createTemplateGenerator } from "./generate.ts";
import { createBuildRunner } from "./queue.ts";

const env = parseBuilderEnv(process.env);
const logger = createLogger({ level: "info" });

// Deploy = the Vercel CLI (authed on the box; optional VERCEL_TOKEN for systemd).
const deploy: DeployPort = (args) =>
  cliDeploy({ files: args.files, name: args.name, token: env.VERCEL_TOKEN });
const teardownVercel: VercelTeardown = (name) =>
  vercelRemove(name, { token: env.VERCEL_TOKEN });

// Neon only when the org key is set (data apps); zero-backend builds skip it.
const neon = env.NEON_API_KEY
  ? createNeonClient({ apiKey: env.NEON_API_KEY, regionId: env.NEON_REGION_ID })
  : undefined;

const runner = createBuildRunner({
  generate: createTemplateGenerator(),
  deploy,
  teardownVercel,
  neon,
  jwksUrl: env.SUPERJAM_JWKS_URL,
  maxConcurrent: env.MAX_CONCURRENT_BUILDS,
});

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

const app = createBuilderApp({
  token: env.BUILDER_TOKEN,
  runner,
  teardown: (args) => teardownApp(args, { teardownVercel, neon }),
  claudeAuth,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "builder listening");
});
