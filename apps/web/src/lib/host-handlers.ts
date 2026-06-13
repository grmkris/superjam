// Bridge handlers the host shell provides to createHostBridge (pivot §3). The
// child SDK's flat method strings map to the nested oRPC bridge router; appId
// is injected from the trusted registration, never the child. auth.getToken
// mints a platform identity token server-side (the private key never reaches
// the browser). Wallet/payments/ai/pot are wired by lane C — until then the
// host-bridge NOT_YET set rejects them.
import type { AppRouterClient } from "@superjam/api/client";
import type { AppId, BridgeMethod } from "@superjam/shared";
import type { BridgeHandlers } from "./bridge/host-bridge";

type AnyCall = (input: Record<string, unknown>) => Promise<unknown>;

export interface HostHandlerOpts {
  /** Resolve the viewer's wallet address (Dynamic embedded wallet). */
  getAddress?: () => Promise<string>;
}

export const makeHostHandlers = (
  client: AppRouterClient,
  webOrigin: string,
  opts: HostHandlerOpts = {}
): BridgeHandlers => ({
  // Route "storage.get" → client.bridge.storage.get({ appId, ...params }).
  call: async (method: BridgeMethod, appId: string, params) => {
    const [ns, op] = method.split(".");
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
    // Host toast UI lands with the frontend chrome; log meanwhile.
    if (typeof console !== "undefined") console.info("[toast]", message);
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
});
