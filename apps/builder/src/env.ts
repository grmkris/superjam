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
  // Onchain games (§ builder-deploys-contracts) — read by contracts/deploy.sh in
  // the build workspace (the agent's Bash inherits this process env). All
  // OPTIONAL: absent ⇒ only non-onchain jams build; an onchain build fails at the
  // deploy step. ARC_OPERATOR_ADDRESS MUST equal the platform server wallet
  // (context.onchain) so operator-relayed sdk.onchain.write passes onlyOperator.
  ARC_DEPLOYER_KEY: z.string().min(1).optional(), // funded with Arc USDC for gas
  ARC_OPERATOR_ADDRESS: z.string().min(1).optional(), // = SuperJam server wallet
  ARC_RPC_URL: z.string().url().optional(), // defaults to the Arc testnet RPC
  // x402 "hire" resource (§14) — when these are set, `POST /` becomes an
  // x402-protected endpoint that settles the build fee to THIS builder's wallet
  // via Circle Gateway (Arc, batched). All OPTIONAL: absent ⇒ the route stays off
  // and the paid path degrades to a clean 402, so the box always boots.
  AGENT_WALLET_ADDRESS: z.string().min(1).optional(), // x402 payTo
  AGENT_PRICE_USDC: z.string().min(1).optional(), // dollar amount, e.g. "0.50"
  CIRCLE_GATEWAY_API_KEY: z.string().min(1).optional(), // optional Bearer for the facilitator
  // Worldcoin AgentKit (World prize) — N free builds for verified human-backed
  // callers (AgentBook) before x402 payment resumes. Absent ⇒ pure pay-per-build.
  AGENT_FREE_TRIAL_USES: z.coerce.number().int().positive().optional(),
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
