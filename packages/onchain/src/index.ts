// @superjam/onchain — the chain adapter seam (§15/§16). DB-FREE and stateless:
// viem clients + the server wallet are injected via `createOnchain(...)`,
// mirroring `createCounterService({ db })`. No DB imports, no @username→address
// resolution — resolution / quotas / "which user" live in the api services;
// resolved addresses are passed in. A failed §23 rehearsal degrades behind this
// seam (tips→public, payX402 disabled) with no change to the call shape.
import type { Address, PublicClient } from "viem";
import { type ChainKey, PRIVATE_CHAIN } from "./chains.ts";
import { OnchainError } from "./errors.ts";
import type { ServerWallet } from "./server-wallet.ts";
import {
  type VerifyTransferParams,
  usdcBalanceOf,
  verifyUsdcTransfer,
} from "./verify.ts";

export interface OnchainDeps {
  /** Base Sepolia client — the public/provable rail (verification, balances). */
  publicClient: PublicClient;
  /** The sole privileged signer (relay, escrow, ENS/8004). */
  serverWallet: ServerWallet;
  /** Arc testnet client (privacy rail reads). Optional — absent ⇒ Arc reads
   *  throw CHAIN_UNAVAILABLE and callers degrade to the public rail (§15). */
  arcClient?: PublicClient;
}

export const createOnchain = ({
  publicClient,
  serverWallet,
  arcClient,
}: OnchainDeps) => {
  const clientFor = (chain: ChainKey): PublicClient => {
    if (chain === PRIVATE_CHAIN) {
      if (!arcClient) {
        throw new OnchainError("CHAIN_UNAVAILABLE", "Arc client not configured");
      }
      return arcClient;
    }
    return publicClient;
  };

  return {
    /** The privileged signer's address — treasury-of-record for escrow/relay. */
    serverAddress: serverWallet.address,

    /** Verify a public-rail receipt by its Transfer log (publish/stake/build). */
    verifyUsdcTransfer: (params: VerifyTransferParams) =>
      verifyUsdcTransfer(clientFor(params.chain), params),

    /** Read a USDC balance (6-dec) on a chain — reads ONE source, never sums. */
    usdcBalance: (chain: ChainKey, account: Address) =>
      usdcBalanceOf(clientFor(chain), chain, account),
  };
};

export type Onchain = ReturnType<typeof createOnchain>;

// --- public surface (the cross-lane seams) ---
export * from "./money.ts";
export * from "./chains.ts";
export * from "./transfer-auth.ts";
export * from "./payment-intent.ts";
export * from "./server-wallet.ts";
export * from "./verify.ts";
export * from "./errors.ts";
