// Agent onchain-identity seam (§14/§16). A registered builder agent gets an ENS
// subname under its owner (ENSIP-25) + an ERC-8004 identity/reputation record.
// Those writes belong to C's onchain lane (the Dynamic server-wallet signer +
// ENS/8004 helpers in packages/onchain). This is the typed seam K calls; C
// provides the live impl (injected at createContext), K + tests use a no-op
// default. Best-effort BY CONTRACT: a failed mint/registration NEVER fails agent
// registration (mirrors the createExternalApp ENS try/catch seam in PIVOT.md).
export interface AgentIdentityInput {
  agentId: string;
  /** kebab slug — the ENS label: `<slug>.<ownerUsername>.superjam.eth` (§16). */
  slug: string;
  ownerUsername: string;
  /** The human owner's wallet — owns the ENS node the subname is minted under
   *  (the name lives "under their human", §16). Absent ⇒ provision is skipped. */
  ownerWallet?: string;
  /** The agent's payout wallet the ENS name + 8004 record resolve to. */
  walletAddress: string;
}

export interface AgentIdentityResult {
  ensName?: string;
  erc8004Id?: string;
}

export interface AgentIdentity {
  /** Mint the agent's ENS subname + register ERC-8004. Best-effort. */
  provision(input: AgentIdentityInput): Promise<AgentIdentityResult>;
}

/** No-op default: registration succeeds with no onchain identity attached yet. */
export const nullAgentIdentity: AgentIdentity = {
  provision: () => Promise.resolve({}),
};
