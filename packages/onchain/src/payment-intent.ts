// The cross-lane payment shape (§15). ONE schema spoken by the bridge, the
// confirm sheet, `useSignAndSend`, and the TX_CAP_USDC cap-check, so every
// surface agrees on what a payment IS. `to` is a `@username` or an address —
// resolution to an on-chain address happens in the api layer (onchain stays
// DB-free + identity-free). `amountUsdc` is the decimal wire string.
import { TX_CAP_USDC } from "@superjam/shared";
import { z } from "zod";
import { type Usdc, parseUsdc } from "./money.ts";

export const PAYMENT_KINDS = ["tip", "publish", "stake", "payFriend"] as const;
export const PaymentKind = z.enum(PAYMENT_KINDS);
export type PaymentKind = z.infer<typeof PaymentKind>;

export const PaymentIntent = z.object({
  kind: PaymentKind,
  /** `@username`, a bare username, or a 0x address — resolved in the api layer. */
  to: z.string().min(1),
  /** Decimal USDC string (the wire format), e.g. "0.50". */
  amountUsdc: z.string().min(1),
  appId: z.string().optional(),
  memo: z.string().optional(),
});
export type PaymentIntent = z.infer<typeof PaymentIntent>;

/** Host-side hard cap per single tx (§2/§15). The same ceiling the confirm
 *  sheet shows and the relay enforces. */
export const TX_CAP: Usdc = parseUsdc(TX_CAP_USDC);

/** True when `amount` exceeds the per-tx cap (the cap itself is allowed). */
export const exceedsCap = (amount: Usdc): boolean => amount > TX_CAP;

/** Parse an intent's decimal amount into branded `Usdc`. */
export const intentAmount = (intent: PaymentIntent): Usdc =>
  parseUsdc(intent.amountUsdc);
