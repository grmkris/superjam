// Env schemas (§1 manifest + §5.1 mode flags). The schema lives here; each app
// parses process.env against it fail-fast in its own env.ts (apps/server,
// apps/web). Core creds (§0.2) are REQUIRED — `env.X` is typed `string`, so no
// `?? ""` fallbacks or `if (!env.X) throw` guards at call sites. Genuinely-gated
// features stay optional. Builds/lint/CI run without secrets via
// SKIP_ENV_VALIDATION (parse is bypassed at build time; runtime boot still
// validates fail-fast). See ~/.claude/plans/which-env-vars-we-calm-truffle.md §F.
import { z } from "zod";
import { ENVIRONMENTS } from "./service-urls.ts";

export const BUILDER_MODES = ["remote", "agent", "oneshot"] as const;

const optionalStr = z.string().min(1).optional();

export const serverEnvSchema = z.object({
  APP_ENV: z.enum(ENVIRONMENTS),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // data
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: optionalStr,
  S3_BUCKET: optionalStr,
  S3_ACCESS_KEY: optionalStr,
  S3_SECRET_KEY: optionalStr,
  S3_REGION: z.string().default("us-east-1"),

  // AI — platform is Gemini-only (refine + in-app sdk.ai). No Anthropic key:
  // builder codegen rides the subscription-authed `claude` CLI on the VPS (§18).
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  FAL_KEY: optionalStr,

  // builder
  BUILDER_MODE: z.enum(BUILDER_MODES).default("remote"),
  BUILDER_URL: optionalStr,
  BUILDER_TOKEN: optionalStr,

  // auth (Dynamic) — env id gates ALL login, so required. API token (onchain
  // server-wallet signer) stays optional until the chain lane provisions it.
  DYNAMIC_ENVIRONMENT_ID: z.string().min(1),
  DYNAMIC_API_TOKEN: optionalStr,

  // app identity token — the platform MINTS these (ES256) so an external,
  // developer-hosted mini-app's backend can verify the SuperJam user against
  // our /.well-known/jwks.json (pivot §1). Required: identity is core surface.
  APP_JWT_PRIVATE_KEY: z.string().min(1), // ES256 PKCS8 PEM (server-only secret)
  APP_JWT_PUBLIC_KEY: z.string().min(1), // ES256 SPKI PEM (published in the JWKS)
  APP_JWT_KID: z.string().min(1).default("sj-app"), // stable key id for rotation

  // World
  WORLD_APP_ID: optionalStr,
  WORLD_ACTION: z.string().default("publish-app"),

  // ENS / onchain
  ENS_L2_REGISTRY: optionalStr,
  ENS_PARENT_NODE: optionalStr,
  ERC8004_REGISTRY: optionalStr,
  TREASURY_ADDRESS: optionalStr,
  BASE_SEPOLIA_RPC_URL: optionalStr,
  SEPOLIA_RPC_URL: optionalStr,
  ARC_RPC_URL: optionalStr,

  // privacy rail (gated)
  UNLINK_API_KEY: optionalStr,
  UNLINK_APP_ID: optionalStr,
  CIRCLE_GATEWAY_API_KEY: optionalStr,
  ARC_PAYER_EOA_KEY: optionalStr,
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const webEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(ENVIRONMENTS),
  NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: optionalStr,
  NEXT_PUBLIC_WORLD_APP_ID: optionalStr,
});
export type WebEnv = z.infer<typeof webEnvSchema>;

// Build-time escape hatch (t3-env's skipValidation pattern): image builds, lint,
// and CI run with no secrets present. Bypasses the parse so a required schema
// doesn't break `next build`/bundling; RUNTIME boot still validates fail-fast
// (Railway has the real secrets). NB: skipping also skips zod .default() — so
// defaulted vars are undefined under the flag; safe because build doesn't read
// them. Keep literal fallbacks at any module-eval read site.
const skipValidation = (source: Record<string, string | undefined>): boolean =>
  Boolean(source.SKIP_ENV_VALIDATION);

/** Parse + assert, throwing a readable aggregate on the first missing/invalid var. */
export const parseServerEnv = (source: Record<string, string | undefined>): ServerEnv => {
  if (skipValidation(source)) return source as unknown as ServerEnv;
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid server env:\n${z.prettifyError(result.error)}`
    );
  }
  return result.data;
};

export const parseWebEnv = (source: Record<string, string | undefined>): WebEnv => {
  if (skipValidation(source)) return source as unknown as WebEnv;
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid web env:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};
