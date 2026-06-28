// Chain + USDC token definitions (§15). ONE source of truth for chain ids, RPC
// hints, USDC contract addresses, and the EIP-712 domain each USDC implements
// for EIP-3009 (transfer-auth.ts reads `domainName`/`domainVersion` from here).
// Testnet-only posture (§15.1): Arc testnet is the single money chain (public +
// privacy rails both); Sepolia L1 is the identity/naming chain (ERC-8004 + ENSv2)
// AND the CCTP #2 cross-chain source (Ethereum Sepolia = CCTP domain 0). Base
// Sepolia was removed 2026-06-13. Mainnet is a post-event config flip.
import type { Address, Chain } from "viem";
import { defineChain } from "viem";
import { sepolia } from "viem/chains";

export type ChainKey = "arcTestnet" | "sepolia";

// Arc testnet (§15.1): id 5042002, gas paid in USDC natively — no paymaster
// exists or is needed. Defined inline so we never depend on viem/chains shipping
// it. RPC per §1 manifest (ARC_RPC_URL overrides at the adapter seam).
export const arcTestnet: Chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
});

export const CHAINS: Record<ChainKey, Chain> = {
  arcTestnet,
  sepolia,
};

/** EIP-712 / ERC-20 descriptor for the USDC on a given chain. The domain
 *  (name+version+chainId+verifyingContract) is what `buildTransferAuth` signs;
 *  defined ONCE here so client and server are byte-identical. */
export interface UsdcToken {
  /** ERC-20 contract + EIP-712 `verifyingContract`. */
  readonly address: Address;
  readonly chainId: number;
  /** EIP-712 domain name (Circle FiatToken reports "USDC"). */
  readonly domainName: string;
  /** EIP-712 domain version (FiatTokenV2_2 = "2"). */
  readonly domainVersion: string;
  readonly decimals: 6;
}

export const USDC: Record<ChainKey, UsdcToken> = {
  // Arc testnet USDC — VERIFIED on-chain 2026-06-13 (cast against rpc.testnet.arc.network):
  // address 0x3600…0000, a real Circle FiatToken v2 — name "USDC", version "2",
  // 6 decimals, DOMAIN_SEPARATOR present ⇒ EIP-3009 transferWithAuthorization
  // supported. (Arc gas IS USDC natively, so the relay is optional here, but the
  // EIP-712 domain below must be byte-correct for any signed transfer.)
  arcTestnet: {
    address: "0x3600000000000000000000000000000000000000",
    chainId: arcTestnet.id,
    domainName: "USDC",
    domainVersion: "2",
    decimals: 6,
  },
  // Ethereum Sepolia USDC (Circle) — the CCTP #2 cross-chain source (domain 0).
  sepolia: {
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    chainId: sepolia.id,
    domainName: "USDC",
    domainVersion: "2",
    decimals: 6,
  },
};

/** The public, provable rail — **Arc** (all-Arc decision 2026-06-13): publish fee,
 *  pot stakes, paid builds, top-up. Transparent USDC transfers (Transfer log →
 *  verifyUsdcTransfer); gas paid in USDC so no relay/paymaster needed. */
export const PUBLIC_CHAIN: ChainKey = "arcTestnet";
/** The private rail (tips, pay-actions via Unlink) — Unlink runs on arc-testnet. */
export const PRIVATE_CHAIN: ChainKey = "arcTestnet";
/** The CCTP #2 cross-chain source — Ethereum Sepolia L1 (domain 0) → Arc (domain 26). */
export const CCTP_SOURCE_CHAIN: ChainKey = "sepolia";
