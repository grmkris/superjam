// Host bridge — the parent half of the §8 boundary. ONE message listener;
// resolves the calling jam by event.source against a Window→registration map;
// zod-parses the envelope; rate-limits (20 calls/s per app+user); capability-
// checks BEFORE any work; dispatches; replies to the iframe. The child SDK
// (@superjam/sdk) is the matching half — method strings + param shapes mirror
// makeBridgeSdk exactly (the host injects appId from the trusted map).
import type { AppContext } from "@superjam/sdk";
import {
  type BridgeMethod,
  BRIDGE_RATE_LIMIT_PER_SEC,
  type Capability,
  methodAllowed,
  type TJErrorCode,
  type TJRequest,
  TJRequestSchema,
  type TJResponse,
  tjErr,
  tjOk,
} from "@superjam/shared";

export interface AppRegistration {
  appId: string;
  slug: string;
  capabilities: Capability[];
  /** app.context reply payload (host-built, server-authoritative identity). */
  context: AppContext;
  /** the iframe's contentWindow — replies are addressed here, never "*"-broadcast wrong. */
  window: Window;
}

// Host-provided implementations. `call` dispatches a server-bridged method to
// the oRPC bridge router with appId injected; the rest are host-local.
export interface BridgeHandlers {
  call(
    method: BridgeMethod,
    appId: string,
    params: Record<string, unknown>
  ): Promise<unknown>;
  shareLink(appId: string, slug: string, data: unknown): string;
  toast(message: string): void;
  getAddress(): Promise<string>;
}

// Methods routed to the oRPC bridge router (server-stamped identity). Wired in
// M3; money/ai/pot/files arrive in M5/M6/M8.
const SERVER_METHODS = new Set<BridgeMethod>([
  "storage.get",
  "storage.getMany",
  "storage.set",
  "storage.delete",
  "storage.clear",
  "storage.list",
  "data.insert",
  "data.get",
  "data.update",
  "data.delete",
  "data.list",
  "counter.increment",
  "counter.top",
  "messages.send",
  "messages.list",
]);

const NOT_YET = new Set<BridgeMethod>([
  "wallet.sendTransaction",
  "payments.payUSDC",
  "payments.usdcBalance",
  "payments.payX402",
  "payments.mine",
  "ai.chat",
  "pot.create",
  "pot.stake",
  "pot.get",
  "pot.resolve",
  "files.upload",
  "data.subscribe",
  "data.unsubscribe",
]);

// Map an oRPC error code onto the §8 envelope error code.
const toTjCode = (code: unknown): TJErrorCode => {
  switch (code) {
    case "QUOTA_EXCEEDED":
      return "QUOTA_EXCEEDED";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "BAD_REQUEST":
    case "NOT_FOUND":
      return "BAD_REQUEST";
    case "UNAUTHORIZED":
      return "UNAUTHORIZED";
    case "FORBIDDEN":
      return "FORBIDDEN_CAPABILITY";
    default:
      return "INTERNAL";
  }
};

/** A simple per-second token bucket keyed by app+user (the §6 bridge cap). */
export const perSecondLimiter = (maxPerSec: number) => {
  const seen = new Map<string, { n: number; sec: number }>();
  return (key: string): boolean => {
    const sec = Math.floor(Date.now() / 1000);
    const e = seen.get(key);
    if (!e || e.sec !== sec) {
      seen.set(key, { n: 1, sec });
      return true;
    }
    e.n += 1;
    return e.n <= maxPerSec;
  };
};

/** Handle ONE parsed request for a registered app. Pure but for the handlers. */
export const dispatch = async (
  req: TJRequest,
  reg: AppRegistration,
  handlers: BridgeHandlers,
  allow: (key: string) => boolean
): Promise<TJResponse> => {
  const { id, method, params } = req;

  if (method === "host.hello" || method === "app.context") {
    return tjOk(id, reg.context);
  }

  if (!allow(`${reg.appId}:${reg.context.user.id}`)) {
    return tjErr(id, "RATE_LIMITED", "Slow down");
  }

  if (!methodAllowed(method, reg.capabilities)) {
    return tjErr(
      id,
      "FORBIDDEN_CAPABILITY",
      `This jam didn't request the "${method}" capability`
    );
  }

  const p = (params ?? {}) as Record<string, unknown>;
  try {
    if (method === "ui.toast") {
      handlers.toast(String(p.message ?? ""));
      return tjOk(id, { ok: true });
    }
    if (method === "share.link") {
      return tjOk(id, {
        url: handlers.shareLink(reg.appId, reg.slug, p.data ?? undefined),
      });
    }
    if (method === "wallet.getAddress") {
      return tjOk(id, await handlers.getAddress());
    }
    if (SERVER_METHODS.has(method)) {
      return tjOk(id, await handlers.call(method, reg.appId, p));
    }
    if (NOT_YET.has(method)) {
      return tjErr(id, "INTERNAL", `${method} is not available yet`);
    }
    return tjErr(id, "BAD_REQUEST", `Unknown method ${method}`);
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    const message = err instanceof Error ? err.message : "Bridge error";
    return tjErr(id, toTjCode(code), message);
  }
};

export interface HostBridge {
  register(reg: AppRegistration): void;
  unregister(window: Window): void;
  /** Attach the listener; returns a detach fn. */
  start(): () => void;
}

/** Wire the single message listener + Window→app registry around `dispatch`. */
export const createHostBridge = (handlers: BridgeHandlers): HostBridge => {
  const registry = new Map<Window, AppRegistration>();
  const allow = perSecondLimiter(BRIDGE_RATE_LIMIT_PER_SEC);

  const onMessage = (e: MessageEvent): void => {
    const reg = e.source ? registry.get(e.source as Window) : undefined;
    if (!reg) {
      return; // unregistered source — ignore (defense in depth)
    }
    const parsed = TJRequestSchema.safeParse(e.data);
    if (!parsed.success) {
      const id = (e.data as { id?: unknown })?.id;
      if (typeof id === "string") {
        reg.window.postMessage(tjErr(id, "BAD_REQUEST", "Malformed request"), "*");
      }
      return;
    }
    void dispatch(parsed.data, reg, handlers, allow).then((resp) =>
      reg.window.postMessage(resp, "*")
    );
  };

  return {
    register: (reg) => registry.set(reg.window, reg),
    unregister: (w) => registry.delete(w),
    start() {
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    },
  };
};
