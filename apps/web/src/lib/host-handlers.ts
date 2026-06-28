// Bridge handlers the host shell provides to createHostBridge (pivot §3). The
// child SDK's flat method strings map to the nested oRPC bridge router; appId
// is injected from the trusted registration, never the child. auth.getToken
// mints a platform identity token server-side (the private key never reaches
// the browser). Wallet/payments/ai/pot are wired by lane C — until then the
// host-bridge NOT_YET set rejects them.
import type { AppRouterClient } from "@superjam/api/client";
import type { AppId, BridgeMethod } from "@superjam/shared";
import {
  type ConfirmKind,
  OverCapError,
  requestConfirm,
} from "../components/confirm/confirm-controller";
import { pushToast } from "../components/toast/toaster";
import type { BridgeHandlers } from "./bridge/host-bridge";

type AnyCall = (input: Record<string, unknown>) => Promise<unknown>;

// SDK method string → [bridge ns, op], ONLY where the SDK contract name differs
// from C's bridge router key. The SDK method `payments.usdcBalance` (fixed in
// bridge.schema) maps to bridge.payments.balance. Remove this entry if/when C
// renames the bridge handler to `usdcBalance`.
const BRIDGE_PATH: Partial<Record<BridgeMethod, readonly [string, string]>> = {
  "payments.usdcBalance": ["payments", "balance"],
};

/** Tag a plain Error with a §8 code the host-bridge maps onto the TJ envelope. */
const coded = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code });

export interface HostHandlerOpts {
  /** Resolve the viewer's wallet address (Dynamic embedded wallet). */
  getAddress?: () => Promise<string>;
  /** Jam attribution shown on the confirm sheet header. */
  jam?: { name: string; iconEmoji: string };
}

export const makeHostHandlers = (
  client: AppRouterClient,
  webOrigin: string,
  opts: HostHandlerOpts = {}
): BridgeHandlers => ({
  // Route "storage.get" → client.bridge.storage.get({ appId, ...params }).
  call: async (method: BridgeMethod, appId: string, params) => {
    const [ns, op] = BRIDGE_PATH[method] ?? method.split(".");
    const bridge = client.bridge as unknown as Record<
      string,
      Record<string, AnyCall>
    >;
    const fn = ns && op ? bridge[ns]?.[op] : undefined;
    if (!fn) throw new Error(`Unroutable bridge method ${method}`);
    return fn({ appId, ...params });
  },

  // Host-side URL math — a deeplink back into this app on the platform.
  shareLink: (_appId, slug, data) => {
    const u = new URL(`/app/${slug}`, webOrigin);
    if (data !== undefined && data !== null) {
      const json = JSON.stringify(data);
      const d =
        typeof btoa === "function"
          ? btoa(unescape(encodeURIComponent(json)))
          : Buffer.from(json, "utf8").toString("base64");
      u.searchParams.set("d", d);
    }
    return u.toString();
  },

  toast: (message) => {
    // Render a real host toast above the jam iframe (the jams' share feedback +
    // any sdk.ui.toast). Singleton store → <Toaster/> in ClientRoot.
    pushToast(message);
  },

  // Wallet address from the Dynamic embedded wallet (via useHostAuth). Until a
  // viewer is signed in, it rejects clearly.
  getAddress: async () => {
    if (!opts.getAddress) throw new Error("Sign in to use your wallet");
    return opts.getAddress();
  },

  // Mint a short-lived identity token for this app + the session user (§1).
  // appId comes from the trusted registration; brand it for the typed input.
  getToken: (appId) => client.auth.mintAppToken({ appId: appId as AppId }),

  // CONFIRM-GATED money (§6): payUSDC NEVER routes straight to the server — it
  // raises P's host-rendered confirm sheet (requestConfirm), which signs with
  // the Dynamic wallet + relays via C's payments. The jam can't move money
  // without the human tapping approve. Over-cap is rejected before the sheet.
  payUSDC: async (appId, params) => {
    const amountUsdc = Number(params.amount);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      throw coded("BAD_REQUEST", "Invalid amount");
    }
    const to = typeof params.to === "string" ? params.to : "appTreasury";
    // @username = paying another human; otherwise a tip to the app treasury.
    const kind: ConfirmKind = to.startsWith("@") ? "payFriend" : "tip";
    let result;
    try {
      result = await requestConfirm({
        kind,
        to,
        amountUsdc,
        appId,
        memo: typeof params.memo === "string" ? params.memo : undefined,
        jam: opts.jam,
      });
    } catch (err) {
      if (err instanceof OverCapError) {
        throw coded("QUOTA_EXCEEDED", err.message);
      }
      throw err;
    }
    if (!result.approved) {
      throw coded("USER_REJECTED", "Payment cancelled");
    }
    return { hash: result.txHash ?? "" };
  },
});
