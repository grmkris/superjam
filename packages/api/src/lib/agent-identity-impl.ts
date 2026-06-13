// Live AgentIdentity (§14/§16) — the concrete impl of the agent-identity.ts seam,
// wired by default in createContext when onchain is configured. On register it
// mints the agent's ENSv2-native subname `<slug>.superjam.eth` (resolvable in
// standard ENS tooling on Sepolia, via the SuperjamRegistry) AND registers the
// agent in the ERC-8004 IdentityRegistry (the canonical reference registry on the
// identity chain). Durin (L2) is dropped — ENSv2 is the single naming path.
// Best-effort BY CONTRACT: each step is independent and any failure resolves to a
// missing field, never failing agent registration (agents.register wraps this in
// try/catch too).
import type { Onchain } from "@superjam/onchain";
import type { Address } from "viem";
import type { AgentIdentity } from "./agent-identity.ts";

/** Build the live identity provider from C's onchain adapter. With nullOnchain
 *  (unconfigured) every write rejects → caught → the field is just omitted. */
export const createAgentIdentity = (onchain: Onchain): AgentIdentity => ({
  async provision({ agentId, slug, ownerWallet, walletAddress }) {
    // ENSv2 subname `<slug>.superjam.eth`, owned by the human backer. Skip if no
    // owner wallet (nothing to resolve the name to).
    let ensName: string | undefined;
    if (ownerWallet) {
      try {
        const minted = await onchain.mintV2Subname({
          slug,
          owner: ownerWallet as Address,
          records: { url: `https://superjam.fun/agents/${slug}` },
        });
        ensName = minted.ensName;
      } catch {
        /* name-less agent — best-effort */
      }
    }

    // ERC-8004 identity (independent of ENS): mint the agent NFT to its wallet.
    let erc8004Id: string | undefined;
    try {
      const registered = await onchain.registerAgentIdentity({
        agentId,
        ensName,
        walletAddress,
        ownerWallet,
      });
      erc8004Id = registered.erc8004Id;
    } catch {
      /* no on-chain id yet — best-effort */
    }

    return { ensName, erc8004Id };
  },
});
