import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { createCircleGateway, type CircleGatewayTransport } from "./circle-gateway.ts";
import { OnchainError } from "./errors.ts";
import { parseUsdc, usdc } from "./money.ts";

const HASH = ("0x" + "cd".repeat(32)) as Hex;

// Records the low-level pay calls; returns a fixed settlement hash.
const recordingTransport = () => {
  const calls: Array<{ url: string; amountUsdc: string }> = [];
  const transport: CircleGatewayTransport = {
    pay: (args) => {
      calls.push(args);
      return Promise.resolve({ hash: HASH });
    },
  };
  return { transport, calls };
};

describe("createCircleGateway.pay", () => {
  test("forwards url + the decimal amount to the transport, returns the hash", async () => {
    const { transport, calls } = recordingTransport();
    const gw = createCircleGateway({ transport });
    const res = await gw.pay("https://api.example.com/x402/resource", parseUsdc("1.5"));
    expect(res.hash).toBe(HASH);
    expect(calls).toEqual([
      { url: "https://api.example.com/x402/resource", amountUsdc: "1.5" },
    ]);
  });

  test("rejects a malformed URL", async () => {
    const gw = createCircleGateway({ transport: recordingTransport().transport });
    await expect(gw.pay("not-a-url", parseUsdc("1"))).rejects.toBeInstanceOf(OnchainError);
  });

  test("rejects a non-https URL", async () => {
    const gw = createCircleGateway({ transport: recordingTransport().transport });
    await expect(gw.pay("http://insecure.example.com/r", parseUsdc("1"))).rejects.toMatchObject({
      code: "RELAY_FAILED",
    });
  });

  test("rejects a non-positive amount", async () => {
    const gw = createCircleGateway({ transport: recordingTransport().transport });
    await expect(gw.pay("https://x.example.com/r", usdc(0n))).rejects.toBeInstanceOf(OnchainError);
  });

  test("maps a transport failure to RELAY_FAILED", async () => {
    const gw = createCircleGateway({
      transport: { pay: () => Promise.reject(new Error("gateway 502")) },
    });
    await expect(gw.pay("https://x.example.com/r", parseUsdc("1"))).rejects.toMatchObject({
      code: "RELAY_FAILED",
    });
  });
});
