// Live AgentIdentity (§14/§16) — the concrete impl of the agent-identity.ts seam,
// wired by default in createContext when onchain is configured. On register it
// mints the agent's ENS subname UNDER its human owner (`slug.username.superjam.eth`)
// via C's onchain ENS helper (Durin L2Registry) AND registers the agent in the
// ERC-8004 IdentityRegistry (the canonical reference registry on Base Sepolia).
// Best-effort BY CONTRACT: each step is independent and any failure resolves to a
// missing field, never failing agent registration (agents.register wraps this in
// try/catch too).
import type { Onchain } from "@superjam/onchain";
import type { Address } from "viem";
import type { AgentIdentity } from "./agent-identity.ts";

/** Build the live identity provider from C's onchain adapter. With nullOnchain
 *  (unconfigured) every write rejects → caught → the field is just omitted. */
export const createAgentIdentity = (onchain: Onchain): AgentIdentity => ({
  async provision({ agentId, slug, ownerUsername, ownerWallet, walletAddress }) {
    // ENS subname needs the human owner's node to mint under; skip if absent.
    let ensName: string | undefined;
    if (ownerWallet) {
      try {
        const minted = await onchain.mintApp({
          slug,
          username: ownerUsername,
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
