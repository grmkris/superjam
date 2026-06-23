// Shared zod validators for onchain primitives — one source for the regexes that
// were duplicated across routers (tx hashes, hex, base-unit ints).
import { z } from "zod";

/** A 32-byte tx hash (also the EIP-3009 nonce shape). */
export const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash");
/** Any 0x-prefixed hex string. */
export const Hex0x = z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid hex");
/** A base-unit integer as a string (USDC 6-dec base units, unix seconds, …). */
export const Uint = z.string().regex(/^\d+$/, "Expected a base-unit integer");
