import { describe, expect, test } from "bun:test";
import type { AppRouterClient } from "@superjam/api/client";
import { makeHostHandlers } from "./host-handlers";

type Call = { path: string; input: Record<string, unknown> };

// Minimal client recording which bridge.<ns>.<op> got called with what.
const mockClient = (calls: Call[]): AppRouterClient => {
  const record =
    (path: string) =>
    (input: Record<string, unknown>): Promise<unknown> => {
      calls.push({ path, input });
      return Promise.resolve({ ok: path });
    };
  return {
    bridge: {
      payments: { balance: record("payments.balance"), mine: record("payments.mine") },
      storage: { get: record("storage.get") },
    },
  } as unknown as AppRouterClient;
};

describe("makeHostHandlers.call routing", () => {
  test("payments.usdcBalance → bridge.payments.balance (name override)", async () => {
    const calls: Call[] = [];
    const h = makeHostHandlers(mockClient(calls), "https://superjam.fun");
    await h.call("payments.usdcBalance", "app_x", {});
    expect(calls[0]?.path).toBe("payments.balance");
    expect(calls[0]?.input.appId).toBe("app_x"); // appId injected from registration
  });

  test("a matching method routes by its own name + injects appId", async () => {
    const calls: Call[] = [];
    const h = makeHostHandlers(mockClient(calls), "https://superjam.fun");
    await h.call("storage.get", "app_y", { key: "k" });
    expect(calls[0]?.path).toBe("storage.get");
    expect(calls[0]?.input).toEqual({ appId: "app_y", key: "k" });
  });
});
