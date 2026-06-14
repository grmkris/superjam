// Confirm controller (DESIGN_BRIEF §3d) — the bridge between non-React callers
// (%67's host-handlers, when a framed jam asks for money) and the React-rendered
// ConfirmSheet. ConfirmProvider registers its imperative `request` here on
// mount; anyone can then call requestConfirm(intent) and await the user's
// decision. This is the ONLY wallet surface — a jam can never draw its own.
import type { TX_CAP_USDC } from "@superjam/shared";

export type ConfirmKind = "tip" | "publish" | "stake" | "payFriend" | "buildFee";

export interface ConfirmIntent {
  kind: ConfirmKind;
  /** recipient address (or ENS) the money goes to. Unused for "buildFee" (the
   *  builder + amount are resolved server-side from `builderId`). */
  to?: string;
  /** ENS name tag to show when known (e.g. tipjar.kris.superjam.fun) */
  toName?: string;
  /** plain USDC amount (not base units); capped at TX_CAP_USDC */
  amountUsdc: number;
  appId?: string;
  /** the marketplace builder to hire — "buildFee" only (drives the x402 quote). */
  builderId?: string;
  memo?: string;
  /** jam attribution for the sheet header */
  jam?: { name: string; iconEmoji: string };
}

export interface ConfirmResult {
  approved: boolean;
  /** the settlement hash — null for a free build (no money moved). */
  txHash?: string | null;
  /** server-signed build-payment receipt (buildFee) — passed to builds.create. */
  paymentToken?: string;
}

/** Thrown synchronously when an amount exceeds the single-tx cap — the sheet
 *  never shows for an over-cap request (design §3d). */
export class OverCapError extends Error {
  constructor(public readonly capUsdc: number) {
    super(`Amount exceeds the ${capUsdc} USDC limit`);
    this.name = "OverCapError";
  }
}

export type ConfirmRequester = (intent: ConfirmIntent) => Promise<ConfirmResult>;

let requester: ConfirmRequester | null = null;

export const registerConfirm = (fn: ConfirmRequester | null): void => {
  requester = fn;
};

export const requestConfirm = (intent: ConfirmIntent): Promise<ConfirmResult> => {
  if (!requester) {
    return Promise.reject(new Error("Confirm sheet is not mounted"));
  }
  return requester(intent);
};

// Re-export the cap value at the type level for callers; the runtime value comes
// from @superjam/shared (TX_CAP_USDC = "25").
export type CapUsdc = typeof TX_CAP_USDC;
