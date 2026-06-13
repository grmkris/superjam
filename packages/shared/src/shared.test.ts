import { describe, expect, test } from "bun:test";
import {
  typeIdGenerator,
  typeIdToUuid,
  typeIdFromUuid,
  validateTypeId,
  UserId,
  AppId,
} from "./typeid.ts";
import {
  TJRequestSchema,
  TJResponseSchema,
  tjOk,
  tjErr,
  BridgeMethod,
} from "./bridge.schema.ts";
import { methodAllowed } from "./capabilities.ts";

describe("typeid", () => {
  test("round-trips id → uuid → id", () => {
    const id = typeIdGenerator("user");
    const { uuid, prefix } = typeIdToUuid(id);
    expect(prefix).toBe("usr");
    expect(typeIdFromUuid("user", uuid)).toBe(id);
  });

  test("validator accepts its own prefix, rejects others", () => {
    const user = typeIdGenerator("user");
    const app = typeIdGenerator("app");
    expect(validateTypeId("user", user)).toBe(true);
    expect(validateTypeId("user", app)).toBe(false);
    expect(UserId.safeParse(user).success).toBe(true);
    expect(AppId.safeParse(user).success).toBe(false);
  });

  test("rejects garbage", () => {
    expect(validateTypeId("user", "nope")).toBe(false);
    expect(validateTypeId("user", "usr_short")).toBe(false);
  });
});

describe("bridge envelopes", () => {
  test("accepts a well-formed request", () => {
    const ok = TJRequestSchema.safeParse({
      tj: 1,
      id: "abc123",
      method: "storage.get",
      params: { key: "x" },
    });
    expect(ok.success).toBe(true);
  });

  test("rejects unknown method", () => {
    const bad = TJRequestSchema.safeParse({
      tj: 1,
      id: "abc123",
      method: "storage.nuke",
      params: {},
    });
    expect(bad.success).toBe(false);
  });

  test("rejects wrong protocol version", () => {
    const bad = TJRequestSchema.safeParse({
      tj: 2,
      id: "x",
      method: "ui.toast",
      params: {},
    });
    expect(bad.success).toBe(false);
  });

  test("tjOk / tjErr build parseable responses", () => {
    expect(TJResponseSchema.safeParse(tjOk("1", { hash: "0x" })).success).toBe(
      true
    );
    const err = tjErr("1", "USER_REJECTED", "no");
    const parsed = TJResponseSchema.safeParse(err);
    expect(parsed.success).toBe(true);
    expect(err.ok).toBe(false);
  });

  test("rejects an error response with a bad code", () => {
    const bad = TJResponseSchema.safeParse({
      tj: 1,
      id: "1",
      ok: false,
      error: { code: "NOPE", message: "x" },
    });
    expect(bad.success).toBe(false);
  });

  test("every BRIDGE_METHODS entry parses", () => {
    for (const m of BridgeMethod.options) {
      expect(BridgeMethod.safeParse(m).success).toBe(true);
    }
  });
});

describe("capabilities", () => {
  test("implicit methods need no capability", () => {
    expect(methodAllowed("storage.set", [])).toBe(true);
    expect(methodAllowed("messages.list", [])).toBe(true);
  });

  test("payments/ai/social gate their methods", () => {
    expect(methodAllowed("payments.payUSDC", [])).toBe(false);
    expect(methodAllowed("payments.payUSDC", ["payments"])).toBe(true);
    expect(methodAllowed("ai.chat", ["payments"])).toBe(false);
    expect(methodAllowed("ai.chat", ["ai"])).toBe(true);
    expect(methodAllowed("messages.send", [])).toBe(false);
    expect(methodAllowed("messages.send", ["social"])).toBe(true);
  });
});
