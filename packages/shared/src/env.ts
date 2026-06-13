// Env schemas (§1 manifest + §5.1 mode flags). The schema lives here; each app
// parses process.env against it fail-fast in its own env.ts (apps/server,
// apps/web). Core creds are assumed present (§0.2) — but we keep most rows
// optional in the SCHEMA so typecheck/build never needs live secrets; the
// server asserts presence of what a given route actually uses at call time.
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

  // AI
  GOOGLE_GENERATIVE_AI_API_KEY: optionalStr,
  ANTHROPIC_API_KEY: optionalStr,
  FAL_KEY: optionalStr,

  // builder
  BUILDER_MODE: z.enum(BUILDER_MODES).default("remote"),
  BUILDER_URL: optionalStr,
  BUILDER_TOKEN: optionalStr,

  // auth (Dynamic)
  DYNAMIC_ENVIRONMENT_ID: optionalStr,
  DYNAMIC_API_TOKEN: optionalStr,

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

/** Parse + assert, throwing a readable aggregate on the first missing/invalid var. */
export const parseServerEnv = (source: Record<string, string | undefined>): ServerEnv => {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid server env:\n${z.prettifyError(result.error)}`
    );
  }
  return result.data;
};

export const parseWebEnv = (source: Record<string, string | undefined>): WebEnv => {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid web env:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};
