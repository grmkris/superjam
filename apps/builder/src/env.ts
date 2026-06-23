// Builder-operator env (deploy design doc §C). This is a SEPARATE credential
// island: the token-gated builder origin holds its OWN Vercel + Neon operator
// keys and NO SuperJam platform secrets. Only the app's own DATABASE_URL is
// ever injected into a deployed app; the SuperJam vars (app id, JWKS URL) are
// public. Parsed at boot (server.ts), not at import, so typecheck/build never
// need live creds.
import { z } from "zod";

const builderEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4710),
  // Shared bearer that gates the public build protocol.
  BUILDER_TOKEN: z.string().min(1),
  // Vercel operator token — OPTIONAL: the deploy is the `vercel` CLI, which uses
  // the box's logged-in session if no token is set (a token is only needed for a
  // headless systemd service).
  VERCEL_TOKEN: z.string().min(1).optional(),
  VERCEL_TEAM_ID: z.string().min(1).optional(),
  // Neon org key — OPTIONAL: only data apps need a per-app DB; zero-backend
  // builds (the demo path) skip Neon entirely.
  NEON_API_KEY: z.string().min(1).optional(),
  NEON_REGION_ID: z.string().min(1).default("aws-us-east-1"),
  // Public JWKS the deployed apps verify SuperJam user tokens against (§1).
  SUPERJAM_JWKS_URL: z
    .string()
    .url()
    .default("https://superjam.fun/.well-known/jwks.json"),
  MAX_CONCURRENT_BUILDS: z.coerce.number().int().positive().default(2),
  // Build DRIVER: "agent" = the free-roaming Claude Agent SDK (subscription `claude`
  // CLI on the box); "harness" = the in-process AI-SDK tool loop (harness-build.ts).
  // Default "agent" so the live box keeps its proven path until the harness is flipped
  // on. The harness needs ANTHROPIC_API_KEY — absent, server.ts falls back to "agent".
  BUILD_DRIVER: z.enum(["agent", "harness"]).default("agent"),
  // Build BACKEND (harness only): "local" = run the toolchain on THIS host (the VPS
  // already has node/npm/vercel); "sandbox" = an isolated microVM (stub for now).
  BUILD_BACKEND: z.enum(["local", "sandbox"]).default("local"),
  // Harness coding-model provider. "auto" (default) prefers an Anthropic key, else
  // the Google (Gemini) key — whichever is configured. We currently only hold a
  // Gemini key, so "auto" lights up the harness on Gemini.
  HARNESS_PROVIDER: z.enum(["auto", "google", "anthropic"]).default("auto"),
  // Anthropic API key for the harness coding model — OPTIONAL (we don't have one yet).
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Override the harness coding-model id. Absent ⇒ a per-provider default
  // (gemini-2.5-pro / claude-sonnet-4-6) chosen in server.ts.
  HARNESS_MODEL: z.string().min(1).optional(),
  // Google key for the build-time asset tools (image/voice). OPTIONAL — absent, the
  // build degrades to emoji/CSS/procedural SFX. Read by BOTH drivers.
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  // Onchain games (§ builder-deploys-contracts) — read by contracts/deploy.sh in
  // the build workspace (the agent's Bash inherits this process env). All
  // OPTIONAL: absent ⇒ only non-onchain jams build; an onchain build fails at the
  // deploy step. ARC_OPERATOR_ADDRESS MUST equal the platform server wallet
  // (context.onchain) so operator-relayed sdk.onchain.write passes onlyOperator.
  ARC_DEPLOYER_KEY: z.string().min(1).optional(), // funded with Arc USDC for gas
  ARC_OPERATOR_ADDRESS: z.string().min(1).optional(), // = SuperJam server wallet
  ARC_RPC_URL: z.string().url().optional(), // defaults to the Arc testnet RPC
});

export type BuilderEnv = z.infer<typeof builderEnvSchema>;

export const parseBuilderEnv = (
  source: Record<string, string | undefined>
): BuilderEnv => {
  const result = builderEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid builder env:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};
