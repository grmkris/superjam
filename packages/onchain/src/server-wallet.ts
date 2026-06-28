// The sole privileged signer (§15.1). ONE instance — the only gas-holder and
// only chain-writer: it relays EIP-3009 transfers, writes ENS/8004 records, and
// custodies + pays out pot escrow. Implemented by the Dynamic server-wallet
// adapter (TSS-MPC, M6); a funded plain viem account is a drop-in fallback
// behind this same interface (§1, the §23 rehearsal swap). K and S reach the
// signer only through `createOnchain`, never directly.
import type { Account, Address, Hex } from "viem";
import type { UsdcToken } from "./chains.ts";
import type { TransferAuthMessage } from "./transfer-auth.ts";

/** A signed EIP-3009 authorization handed to the relayer to submit. */
export interface RelayTransferArgs {
  token: UsdcToken;
  authorization: TransferAuthMessage;
  /** The user's EIP-712 signature over `buildTransferAuth(...)`. */
  signature: Hex;
}

export interface ServerWallet {
  /** The privileged address: gas holder, escrow custodian, relayer, ENS writer. */
  readonly address: Address;
  /** The underlying viem account — used to build an x402 `ClientEvmSigner` so the
   *  server wallet can sign anonymous-x402 payment authorizations (§3). Optional
   *  so test mocks can omit it; the live impls always set it. */
  readonly account?: Account;
  /** Submit `transferWithAuthorization(...)`, pay the ETH, await the receipt,
   *  return the real tx hash (§13). Throws `OnchainError("RELAY_FAILED")`. */
  relayTransfer(args: RelayTransferArgs): Promise<Hex>;
  /** Generic contract write (ENS subname mint, 8004 register, pot payout,
   *  top-up). Returns the tx hash. */
  writeContract(args: WriteContractArgs): Promise<Hex>;
  /** Native/ERC-20 send used by top-up (Base Sepolia USDC) + the ETH backstop. */
  sendUsdc(args: SendUsdcArgs): Promise<Hex>;
}

export interface WriteContractArgs {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

export interface SendUsdcArgs {
  token: UsdcToken;
  to: Address;
  value: bigint;
}
