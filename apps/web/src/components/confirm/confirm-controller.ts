// Confirm controller (DESIGN_BRIEF §3d) — the bridge between non-React callers
// (%67's host-handlers, when a framed jam asks for money) and the React-rendered
// ConfirmSheet. ConfirmProvider registers its imperative `request` here on
// mount; anyone can then call requestConfirm(intent) and await the user's
// decision. This is the ONLY wallet surface — a jam can never draw its own.
import type { TX_CAP_USDC } from "@superjam/shared";

export type ConfirmKind = "tip" | "publish" | "stake" | "payFriend";

export interface ConfirmIntent {
  kind: ConfirmKind;
  /** recipient the money goes to: a 0x address, an "@username", "appTreasury", or
   *  "potEscrow" (resolved to an address server-side via payments.resolveRecipient). */
  to?: string;
  /** name tag to show when known (e.g. the jam name or @username) */
  toName?: string;
  /** plain USDC amount (not base units); capped at TX_CAP_USDC */
  amountUsdc: number;
  appId?: string;
  memo?: string;
  /** jam attribution for the sheet header */
  jam?: { name: string; iconEmoji: string };
}

export interface ConfirmResult {
  approved: boolean;
  /** the settlement hash (the relayed EIP-3009 tx). */
  txHash?: string | null;
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
