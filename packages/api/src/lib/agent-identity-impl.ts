// Live AgentIdentity (§14/§16) — the concrete impl of the agent-identity.ts seam,
// wired by default in createContext when onchain is configured. On register it
// mints the agent's ENS subname UNDER its human owner (`slug.username.superjam.eth`)
// via C's onchain ENS helper (Durin L2Registry). Best-effort BY CONTRACT: any
// failure resolves to {} so it never fails agent registration (agents.register
// wraps this in try/catch too). ERC-8004 reputation is left for when C's 8004
// registry write-path lands — this returns ensName only.
import type { Onchain } from "@superjam/onchain";
import type { Address } from "viem";
import type { AgentIdentity } from "./agent-identity.ts";

/** Build the live identity provider from C's onchain adapter. With nullOnchain
 *  (unconfigured) every mint rejects → caught → {} (graceful, name-less agent). */
export const createAgentIdentity = (onchain: Onchain): AgentIdentity => ({
  async provision({ slug, ownerUsername, ownerWallet }) {
    // No owner wallet ⇒ no node to mint under; skip (the agent stays un-named).
    if (!ownerWallet) {
      return {};
    }
    try {
      // mintApp ensures `username.superjam.eth` exists, then mints the agent's
      // `slug.username.superjam.eth` under it and sets its records.
      const { ensName } = await onchain.mintApp({
        slug,
        username: ownerUsername,
        owner: ownerWallet as Address,
        records: { url: `https://superjam.fun/agents/${slug}` },
      });
      return { ensName };
    } catch {
      return {};
    }
  },
});
