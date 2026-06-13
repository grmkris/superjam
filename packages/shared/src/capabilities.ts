// App capabilities (§6). An app's manifest declares which of these it needs;
// the host bridge rejects (FORBIDDEN_CAPABILITY) any method whose required
// capability is absent, BEFORE rendering any UI or touching a router.
import type { BridgeMethod } from "./bridge.schema.ts";

export const CAPABILITIES = ["payments", "ai", "social"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const isCapability = (x: unknown): x is Capability =>
  typeof x === "string" && (CAPABILITIES as readonly string[]).includes(x);

// method → required capability, or null when implicit (always allowed).
//   payments → wallet.sendTransaction + payments.* + pot.* (the money surface)
//   ai       → ai.chat (cost-bearing)
//   social   → messages.send (the spam-bearing user-to-user push)
// storage / data / counter / profile / ui / messages.list / share.link /
// files.upload / wallet.getAddress / app.context are implicit (§6).
export const METHOD_CAPABILITY: Record<BridgeMethod, Capability | null> = {
  "host.hello": null,
  "app.context": null,
  "wallet.getAddress": null,
  "wallet.sendTransaction": "payments",
  "payments.payUSDC": "payments",
  "payments.usdcBalance": "payments",
  "payments.payX402": "payments",
  "payments.mine": "payments",
  "storage.get": null,
  "storage.getMany": null,
  "storage.set": null,
  "storage.delete": null,
  "storage.clear": null,
  "storage.list": null,
  "data.insert": null,
  "data.get": null,
  "data.update": null,
  "data.delete": null,
  "data.list": null,
  "counter.increment": null,
  "counter.top": null,
  "ai.chat": "ai",
  "pot.create": "payments",
  "pot.stake": "payments",
  "pot.get": "payments",
  "pot.resolve": "payments",
  "messages.send": "social",
  "messages.list": null,
  "social.send": "social",
  "share.link": null,
  "files.upload": null,
  "ui.toast": null,
  "auth.getToken": null,
  "data.subscribe": null,
  "data.unsubscribe": null,
};

/** True when an app holding `granted` capabilities may call `method`. */
export const methodAllowed = (
  method: BridgeMethod,
  granted: readonly Capability[]
): boolean => {
  const required = METHOD_CAPABILITY[method];
  return required === null || granted.includes(required);
};
