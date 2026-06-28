// Chain + USDC token definitions (§15). ONE source of truth for chain ids, RPC
// hints, USDC contract addresses, and the EIP-712 domain each USDC implements
// for EIP-3009 (transfer-auth.ts reads `domainName`/`domainVersion` from here).
// Money chain = Base, selected per environment: dev/local → Base Sepolia
// (testnet), prod → Base mainnet. Identity/naming (ERC-8004 + ENSv2) stays on
// Sepolia L1, which is ALSO the CCTP #2 cross-chain source (Ethereum Sepolia =
// CCTP domain 0). Gas on Base is ETH (not USDC), so USDC transfers ride the
// EIP-3009 relay (transfer-auth.ts) rather than being paid as native gas.
import type { Address, Chain } from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";

export type ChainKey = "baseMainnet" | "baseSepolia" | "sepolia";

export const CHAINS: Record<ChainKey, Chain> = {
  baseMainnet: base, // id 8453
  baseSepolia, // id 84532
  sepolia, // id 11155111
};

// Money chain selection. DEFAULTS to Base Sepolia (testnet) in EVERY environment —
// including prod — so no real funds are ever required to run all features. Flip a
// funded deployment to real-money Base mainnet by setting MONEY_CHAIN=baseMainnet
// (server) + NEXT_PUBLIC_MONEY_CHAIN=baseMainnet (web build). Resolved at module
// load: the server reads MONEY_CHAIN; the web bundle inlines NEXT_PUBLIC_MONEY_CHAIN.
const moneyChainOverride =
  process.env.MONEY_CHAIN ?? process.env.NEXT_PUBLIC_MONEY_CHAIN;

/** The public, provable money rail — **Base** (Sepolia by default; mainnet when
 *  explicitly opted in via MONEY_CHAIN): publish fee, pot stakes, paid builds,
 *  top-up. Transparent USDC transfers (Transfer log → verifyUsdcTransfer); gas is
 *  ETH, so transfers ride the EIP-3009 relay (transfer-auth.ts). */
export const PUBLIC_CHAIN: ChainKey =
  moneyChainOverride === "baseMainnet" ? "baseMainnet" : "baseSepolia";
/** The private rail (tips, pay-actions via Unlink) — same Base chain. */
export const PRIVATE_CHAIN: ChainKey = PUBLIC_CHAIN;
/** The CCTP #2 cross-chain source — Ethereum Sepolia L1 (domain 0). */
export const CCTP_SOURCE_CHAIN: ChainKey = "sepolia";

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
  // Base mainnet native USDC (Circle FiatTokenProxy) — 0x8335…2913, 6 decimals,
  // EIP-712 domain name "USDC" version "2" (FiatTokenV2_2) ⇒ EIP-3009 supported.
  baseMainnet: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    chainId: base.id,
    domainName: "USDC",
    domainVersion: "2",
    decimals: 6,
  },
  // Base Sepolia testnet USDC (Circle) — 0x036C…cF7e, 6 decimals, FiatTokenV2_2.
  baseSepolia: {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    chainId: baseSepolia.id,
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
