import { describe, expect, test } from "bun:test";
import type { AppContext } from "@superjam/sdk";
import type { BridgeMethod, Capability, TJRequest } from "@superjam/shared";
import {
  type AppRegistration,
  type BridgeHandlers,
  dispatch,
  perSecondLimiter,
} from "./host-bridge.ts";

const ctx = (): AppContext => ({
  appId: "app_x",
  slug: "tipjar",
  name: "Tip Jar",
  ensName: null,
  category: "tool",
  remixOf: null,
  launch: null,
  user: { id: "usr_1", username: "kris", walletAddress: "0x1", worldVerified: true },
});

const reg = (capabilities: Capability[] = []): AppRegistration => ({
  appId: "app_x",
  slug: "tipjar",
  capabilities,
  context: ctx(),
  window: {} as Window,
});

const req = (method: BridgeMethod, params: unknown = {}): TJRequest => ({
  tj: 1,
  id: "r1",
  method,
  params,
});

const handlers = (over: Partial<BridgeHandlers> = {}): BridgeHandlers => ({
  call: async () => ({ ok: true }),
  shareLink: () => "https://superjam.fun/app/tipjar?d=abc",
  toast: () => {},
  getAddress: async () => "0xabc",
  ...over,
});

const always = () => true;
const deny = () => false;

describe("dispatch", () => {
  test("host.hello and app.context return the context (no rate/cap gate)", async () => {
    for (const m of ["host.hello", "app.context"] as BridgeMethod[]) {
      const res = await dispatch(req(m), reg(), handlers(), deny);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect((res.result as AppContext).slug).toBe("tipjar");
      }
    }
  });

  test("server method routes to handlers.call with appId injected", async () => {
    let seen: unknown;
    const h = handlers({
      call: async (method, appId, params) => {
        seen = { method, appId, params };
        return null;
      },
    });
    const res = await dispatch(
      req("storage.get", { key: "score" }),
      reg(),
      h,
      always
    );
    expect(res.ok).toBe(true);
    expect(seen).toEqual({
      method: "storage.get",
      appId: "app_x",
      params: { key: "score" },
    });
  });

  test("ui.toast / share.link / wallet.getAddress are host-local", async () => {
    let toasted = "";
    const h = handlers({ toast: (m) => (toasted = m) });
    expect((await dispatch(req("ui.toast", { message: "hi" }), reg(), h, always)).ok).toBe(true);
    expect(toasted).toBe("hi");

    const share = await dispatch(req("share.link", { data: { a: 1 } }), reg(), h, always);
    expect(share.ok && (share.result as { url: string }).url).toContain("/app/tipjar");

    const addr = await dispatch(req("wallet.getAddress"), reg(), h, always);
    expect(addr.ok && addr.result).toBe("0xabc");
  });

  test("capability gate fires before work (FORBIDDEN_CAPABILITY)", async () => {
    const r = await dispatch(req("payments.payUSDC", { amount: "1" }), reg([]), handlers(), always);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("FORBIDDEN_CAPABILITY");
    }
    const r2 = await dispatch(req("messages.send", { to: "x", text: "y" }), reg([]), handlers(), always);
    expect(!r2.ok && r2.error.code).toBe("FORBIDDEN_CAPABILITY");
  });

  test("granted-but-unimplemented method → INTERNAL (not yet)", async () => {
    const r = await dispatch(
      req("payments.payUSDC", { amount: "1" }),
      reg(["payments"]),
      handlers(),
      always
    );
    expect(!r.ok && r.error.code).toBe("INTERNAL");
  });

  test("rate limit → RATE_LIMITED", async () => {
    const r = await dispatch(req("storage.get", { key: "k" }), reg(), handlers(), () => false);
    expect(!r.ok && r.error.code).toBe("RATE_LIMITED");
  });

  test("oRPC error codes map to envelope codes", async () => {
    const throwing = (code: string) =>
      handlers({
        call: async () => {
          throw Object.assign(new Error("nope"), { code });
        },
      });
    const q = await dispatch(req("storage.set", { key: "k", value: 1 }), reg(), throwing("QUOTA_EXCEEDED"), always);
    expect(!q.ok && q.error.code).toBe("QUOTA_EXCEEDED");
    const f = await dispatch(req("data.update", { collection: "c", id: "rec_1", patch: {} }), reg(), throwing("FORBIDDEN"), always);
    expect(!f.ok && f.error.code).toBe("FORBIDDEN_CAPABILITY");
    const u = await dispatch(req("storage.get", { key: "k" }), reg(), throwing("WAT"), always);
    expect(!u.ok && u.error.code).toBe("INTERNAL");
  });
});

describe("perSecondLimiter", () => {
  test("allows up to max per second", () => {
    const allow = perSecondLimiter(3);
    expect([allow("k"), allow("k"), allow("k"), allow("k")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(allow("other")).toBe(true);
  });
});
