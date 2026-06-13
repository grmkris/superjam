// Live AgentIdentity (§14/§16) — the concrete impl of the agent-identity.ts seam,
// wired by default in createContext when onchain is configured. On register it
// mints the agent's ENSv2-native subname `<slug>.superjam.eth` (resolvable in
// standard ENS tooling on Sepolia, via the SuperjamRegistry) AND registers the
// agent in the ERC-8004 IdentityRegistry (the canonical reference registry on the
// identity chain). Durin (L2) is dropped — ENSv2 is the single naming path.
// Best-effort BY CONTRACT: each step is independent and any failure resolves to a
// missing field, never failing agent registration (agents.register wraps this in
// try/catch too).
import { type Onchain, parseUsdc } from "@superjam/onchain";
import type { Address } from "viem";
import type { AgentIdentity } from "./agent-identity.ts";

/** Sponsored seed stake (USDC) the platform posts into the StakeSlash yield-escrow
 *  for a newly registered agent, so it has skin-in-the-game that earns yield. */
const SEED_STAKE_USDC = "1";

/** Build the live identity provider from C's onchain adapter. With nullOnchain
 *  (unconfigured) every write rejects → caught → the field is just omitted. */
export const createAgentIdentity = (onchain: Onchain): AgentIdentity => ({
  async provision({ agentId, slug, ownerWallet, walletAddress, current }) {
    // ENSv2 subname `<slug>.superjam.eth`, owned by the human backer. Skip if no
    // owner wallet (nothing to resolve the name to) OR already minted (refresh).
    let ensName: string | undefined = current?.ensName ?? undefined;
    if (ownerWallet && !ensName) {
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
    // Skip if already minted — re-minting would create a duplicate NFT (refresh).
    let erc8004Id: string | undefined = current?.erc8004Id ?? undefined;
    if (!erc8004Id) {
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
    }

    // Sponsored seed stake into the StakeSlash yield-escrow (Circle #1): the
    // agent's wallet gets a stake that earns yield in the vault, signed by the
    // Dynamic MPC wallet (depositFor pulls USDC from the server). Best-effort —
    // an un-funded server / unconfigured escrow just leaves the agent un-staked.
    // Skip if already staked (refresh) so we don't top up on every re-provision.
    let stakeTxHash: string | undefined;
    let stakedUsdc: string | undefined = current?.stakedUsdc ?? undefined;
    if (onchain.stakeSlash && walletAddress && !stakedUsdc) {
      try {
        stakeTxHash = await onchain.stakeSlash.depositFor(
          walletAddress as Address,
          parseUsdc(SEED_STAKE_USDC)
        );
        stakedUsdc = SEED_STAKE_USDC;
      } catch {
        /* un-staked agent — best-effort */
      }
    }

    return { ensName, erc8004Id, stakeTxHash, stakedUsdc };
  },
});
