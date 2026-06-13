// World AgentKit "AgentBook" — the human-backing registry (§14, World prize). A
// builder agent's wallet is registered (out-of-band: the `agentkit` CLI + the
// human's World App, gasless via a hosted relay — the agent wallet does NOT sign)
// to a unique World ID human. We only READ it: given an agent wallet, resolve the
// anonymous human id behind it (or null when un-backed) to badge the agent card.
//
// Verified on-chain 2026-06-13: the canonical AgentBook is `0xA23a…` on WORLD CHAIN
// (id 480) — registration relays through Base, but the lookup ALWAYS resolves on
// World Chain. The sole read fn is `lookupHuman(address) → uint256` (0 ⇒ un-backed,
// else the World ID nullifier). This is exactly what `@worldcoin/agentkit-core`'s
// `createAgentBookVerifier().lookupHuman()` does — one viem read — so we bind it
// directly (the repo idiom; no SDK dep), mirroring erc8004.ts / stake-slash.ts.
import { type Address, type PublicClient, toHex } from "viem";

/** Canonical AgentBook on World Chain (480) — the default `agentkit register`
 *  target + the SDK default. Override via AGENTBOOK_ADDRESS only if it ever moves. */
export const AGENT_BOOK_ADDRESS: Address =
  "0xA23aB2712eA7BBa896930544C7d6636a96b944dA";

// Minimal ABI — the one read we need (viem matches by name+args).
const AGENT_BOOK_ABI = [
  {
    type: "function",
    name: "lookupHuman",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "humanId", type: "uint256" }],
  },
] as const;

export interface AgentBookDeps {
  /** A World Chain (id 480) public client — the lookup resolves there. */
  publicClient: PublicClient;
  /** AgentBook contract. Defaults to the canonical World Chain deployment. */
  address?: Address;
}

export const createAgentBook = ({ publicClient, address }: AgentBookDeps) => {
  const contract = address ?? AGENT_BOOK_ADDRESS;
  return {
    /** The human id (hex nullifier) backing `agent`, or null when un-backed.
     *  Read-only + best-effort: any RPC error resolves to null (never throws —
     *  AgentBook detection must never fail an agent register/refresh). */
    async lookupHuman(agent: Address): Promise<string | null> {
      try {
        const humanId = (await publicClient.readContract({
          address: contract,
          abi: AGENT_BOOK_ABI,
          functionName: "lookupHuman",
          args: [agent],
        })) as bigint;
        return humanId === 0n ? null : toHex(humanId);
      } catch {
        return null;
      }
    },
  };
};

export type AgentBook = ReturnType<typeof createAgentBook>;

/** Unconfigured stub — `lookupHuman` always resolves null (keyless CI build +
 *  tests). So callers can call `onchain.agentBook.lookupHuman(...)` unconditionally. */
export const nullAgentBook: AgentBook = {
  lookupHuman: () => Promise.resolve(null),
};
