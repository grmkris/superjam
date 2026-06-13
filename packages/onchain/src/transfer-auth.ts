// THE ONE EIP-712 builder (§13/§15.1). `buildTransferAuth` produces the exact
// typed-data object for USDC EIP-3009 `transferWithAuthorization`. The frontend
// (`useSignAndSend`) and the server (`payments.relay`) both import THIS — a
// one-field drift between them = an invalid signature = a silent payment
// failure (the #1 cross-lane bug), so there is exactly one definition.
//
// Domain, types, nonce, and the validBefore window are all defined here, once.
import { bytesToHex } from "viem";
import type { Address, Hex, TypedDataDomain } from "viem";
import type { UsdcToken } from "./chains.ts";
import type { Usdc } from "./money.ts";

/** EIP-712 struct for EIP-3009 (Circle FiatToken). Order is consensus-critical
 *  — it's hashed into the signature; do not reorder. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const TRANSFER_WITH_AUTHORIZATION_PRIMARY_TYPE =
  "TransferWithAuthorization" as const;

/** The signed message body. `value` is `Usdc` (6-dec base units). */
export interface TransferAuthMessage {
  from: Address;
  to: Address;
  value: Usdc;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export interface BuildTransferAuthParams extends TransferAuthMessage {
  /** The USDC token whose domain we sign against (chains.ts). */
  usdc: UsdcToken;
}

/** The full typed-data payload — exactly what `signTypedData` (client) consumes
 *  and what the relay reconstructs to recover/submit (server). */
export interface TransferAuthTypedData {
  domain: TypedDataDomain;
  types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
  primaryType: typeof TRANSFER_WITH_AUTHORIZATION_PRIMARY_TYPE;
  message: TransferAuthMessage;
}

export const buildTransferAuth = ({
  usdc,
  from,
  to,
  value,
  validAfter,
  validBefore,
  nonce,
}: BuildTransferAuthParams): TransferAuthTypedData => ({
  domain: {
    name: usdc.domainName,
    version: usdc.domainVersion,
    chainId: usdc.chainId,
    verifyingContract: usdc.address,
  },
  types: TRANSFER_WITH_AUTHORIZATION_TYPES,
  primaryType: TRANSFER_WITH_AUTHORIZATION_PRIMARY_TYPE,
  message: { from, to, value, validAfter, validBefore, nonce },
});

/** One-time random bytes32 nonce (EIP-3009 replay guard, §15.1). */
export const randomTransferNonce = (): Hex => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

/** Default authorization lifetime: 1h. */
export const DEFAULT_AUTH_TTL_SEC = 3600n;

/** validAfter/validBefore window for an authorization. `nowSec` is injected
 *  (unix seconds) so the builder stays pure and testable; the server rejects
 *  expiry, the value bounds the replay window. */
export const authWindow = (
  nowSec: bigint,
  ttlSec: bigint = DEFAULT_AUTH_TTL_SEC
): { validAfter: bigint; validBefore: bigint } => ({
  validAfter: 0n,
  validBefore: nowSec + ttlSec,
});
