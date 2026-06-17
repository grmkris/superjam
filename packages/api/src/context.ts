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
import { type AgentIdentity, nullAgentIdentity } from "./lib/agent-identity.ts";
import {
  type AgentReputation,
  nullAgentReputation,
} from "./lib/agent-reputation.ts";
import { type PotOracle, nullOracle } from "./lib/oracle.ts";
import type { RateLimiter } from "./lib/rate-limit.ts";
import { type ObjectStore, nullObjectStore } from "./services/object-store.ts";

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
  /** Blob storage for uploads/bundles (§17, S3/Railway bucket). Degraded by default. */
  objectStore: ObjectStore;
  /** Builder-agent onchain identity (ENS subname + ERC-8004, §14/§16). No-op default. */
  agentIdentity: AgentIdentity;
  /** Builder-agent ERC-8004 reputation (review→feedback, §14/§16). No-op default. */
  agentReputation: AgentReputation;
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
  /** Optional — defaults to the degraded object store (uploads/presign reject). */
  objectStore?: ObjectStore;
  /** Optional — defaults to the no-op identity (register skips ENS/8004). */
  agentIdentity?: AgentIdentity;
  /** Optional — defaults to the no-op reputation (reviews skip the 8004 write). */
  agentReputation?: AgentReputation;
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
    objectStore: deps.objectStore ?? nullObjectStore,
    // Onchain agent identity (ENS / ERC-8004) + reputation are dropped for now —
    // agents are plain marketplace rows. The no-op defaults make register/review
    // succeed with nothing attached on-chain.
    agentIdentity: deps.agentIdentity ?? nullAgentIdentity,
    agentReputation: deps.agentReputation ?? nullAgentReputation,
    treasuryAddress: deps.treasuryAddress,
    headers: deps.headers,
  };
};
