// oRPC request context (§12). Long-lived deps (db, logger, auth verifier) are
// injected once; `headers` is per-request. The protected middleware reads the
// bearer token from `headers` and adds `user`.
import type { Database } from "@superjam/db";
import type { Logger } from "@superjam/logger";
import { type Onchain, nullOnchain } from "@superjam/onchain";
import type { Address } from "viem";
import { type AppTokenIssuer, nullAppTokenIssuer } from "./auth/app-token.ts";
import type { AuthVerifier } from "./auth/verifier.ts";
import { type WorldVerifier, nullWorldVerifier } from "./auth/world.ts";
import type { AgentIdentity } from "./lib/agent-identity.ts";
import { createAgentIdentity } from "./lib/agent-identity-impl.ts";
import { type PotOracle, nullOracle } from "./lib/oracle.ts";
import type { RateLimiter } from "./lib/rate-limit.ts";

export interface ApiContext {
  db: Database;
  logger: Logger;
  auth: AuthVerifier;
  rateLimiter: RateLimiter;
  /** Mints identity tokens for external apps (pivot §1). Keyless by default. */
  issuer: AppTokenIssuer;
  /** Chain adapter (payments/pots/ENS, §15/§16). Degraded by default. */
  onchain: Onchain;
  /** AI pot-resolution oracle (§9). Disabled by default. */
  oracle: PotOracle;
  /** World ID backend verifier (§14, the human gate). Keyless by default. */
  world: WorldVerifier;
  /** Builder-agent onchain identity (ENS subname + ERC-8004, §14/§16). No-op default. */
  agentIdentity: AgentIdentity;
  /** Platform treasury — recipient of the publish fee (§15). */
  treasuryAddress?: Address;
  headers: Headers;
}

export interface CreateContextDeps {
  db: Database;
  logger: Logger;
  auth: AuthVerifier;
  rateLimiter: RateLimiter;
  /** Optional — defaults to the keyless issuer so existing callers/tests work. */
  issuer?: AppTokenIssuer;
  /** Optional — defaults to the degraded onchain so boot/tests stay green. */
  onchain?: Onchain;
  /** Optional — defaults to the null oracle (AI-resolve unavailable). */
  oracle?: PotOracle;
  /** Optional — defaults to the keyless World verifier (verify rejects). */
  world?: WorldVerifier;
  /** Optional — defaults to the no-op identity (register skips ENS/8004). */
  agentIdentity?: AgentIdentity;
  treasuryAddress?: Address;
  headers: Headers;
}

export const createContext = (deps: CreateContextDeps): ApiContext => {
  const onchain = deps.onchain ?? nullOnchain;
  return {
    db: deps.db,
    logger: deps.logger,
    auth: deps.auth,
    rateLimiter: deps.rateLimiter,
    issuer: deps.issuer ?? nullAppTokenIssuer,
    onchain,
    oracle: deps.oracle ?? nullOracle,
    world: deps.world ?? nullWorldVerifier,
    // Defaults to the live ENS-minting identity over whatever onchain we have
    // (nullOnchain ⇒ mints reject ⇒ provision returns {} — still best-effort).
    agentIdentity: deps.agentIdentity ?? createAgentIdentity(onchain),
    treasuryAddress: deps.treasuryAddress,
    headers: deps.headers,
  };
};
