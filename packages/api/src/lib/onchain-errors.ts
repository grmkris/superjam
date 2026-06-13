// Map a transport-agnostic OnchainError onto an oRPC error (§12). Receipt /
// verification failures are the caller's problem (BAD_REQUEST); misconfig or a
// relay blow-up is ours (INTERNAL). Non-OnchainErrors pass through untouched.
import { OnchainError } from "@superjam/onchain";
import { ORPCError } from "@orpc/server";

const CODE_MAP: Record<string, "BAD_REQUEST" | "INTERNAL"> = {
  TRANSFER_NOT_FOUND: "BAD_REQUEST",
  RECEIPT_REVERTED: "BAD_REQUEST",
  AUTH_EXPIRED: "BAD_REQUEST",
  CHAIN_UNAVAILABLE: "INTERNAL",
  RELAY_FAILED: "INTERNAL",
  ENS_WRITE_FAILED: "INTERNAL",
};

/** Run an onchain op, translating OnchainError → ORPCError. */
export const tryOnchain = async <T>(op: () => Promise<T>): Promise<T> => {
  try {
    return await op();
  } catch (err) {
    if (err instanceof OnchainError) {
      throw new ORPCError(CODE_MAP[err.code] ?? "INTERNAL", {
        message: err.message,
      });
    }
    throw err;
  }
};
