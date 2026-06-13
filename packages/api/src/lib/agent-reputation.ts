// Agent reputation seam (§14/§16). A verified review on a jam BUILT BY a
// marketplace agent feeds that builder's ERC-8004 reputation record (rating +
// a hash of the text). The on-chain write belongs to C's onchain lane (the
// ERC-8004 ReputationRegistry helper in packages/onchain). This is the typed
// seam the reviews router calls; C provides the live impl (injected at
// createContext), the router + tests use a no-op default. Best-effort BY
// CONTRACT: a failed reputation write NEVER fails the review (mirrors the ENS
// best-effort seam in agent-identity.ts).
export interface AgentReputationInput {
  /** The builder's ERC-8004 identity id (resolved by the caller from the agent). */
  erc8004Id: string;
  /** 1-5, the review's rating. */
  rating: number;
  /** The review text — the impl hashes it for the on-chain feedback record. */
  text?: string;
}

export interface AgentReputation {
  /** Record a verified review against the builder's ERC-8004 reputation. */
  recordReview(input: AgentReputationInput): Promise<void>;
}

/** No-op default: reviews succeed with no reputation write yet (until C's
 *  ERC-8004 write-path lands and createAgentReputation replaces this). */
export const nullAgentReputation: AgentReputation = {
  recordReview: () => Promise.resolve(),
};
