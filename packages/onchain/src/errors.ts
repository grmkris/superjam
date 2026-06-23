// Typed onchain failures. `packages/onchain` is transport-agnostic (no oRPC),
// so it throws these; the api layer maps `code` → an ORPCError. Keeps the
// adapter seam free of HTTP concerns.
export type OnchainErrorCode =
  | "RECEIPT_REVERTED"
  | "TRANSFER_NOT_FOUND"
  | "CHAIN_UNAVAILABLE"
  | "RELAY_FAILED"
  | "AUTH_EXPIRED"
  | "ENS_WRITE_FAILED";

export class OnchainError extends Error {
  readonly code: OnchainErrorCode;
  constructor(code: OnchainErrorCode, message?: string) {
    super(message ?? code);
    this.name = "OnchainError";
    this.code = code;
  }
}
