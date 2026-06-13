// Live AgentReputation (§14/§16) — the concrete impl of the agent-reputation.ts
// seam, wired by default in createContext when onchain is configured. Records a
// verified review as ERC-8004 feedback (rating as an int128 + a keccak256 hash of
// the review text) via C's onchain ReputationRegistry binding. Best-effort BY
// CONTRACT: with nullOnchain (unconfigured) writeReputation rejects → the reviews
// router's try/catch swallows it → the review is never blocked.
import type { Onchain } from "@superjam/onchain";
import { keccak256, toHex } from "viem";
import type { AgentReputation } from "./agent-reputation.ts";

export const createAgentReputation = (onchain: Onchain): AgentReputation => ({
  async recordReview({ erc8004Id, rating, text }) {
    await onchain.writeReputation({
      erc8004Id,
      rating,
      textHash: keccak256(toHex(text ?? "")),
    });
  },
});
