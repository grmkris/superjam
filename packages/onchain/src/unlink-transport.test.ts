import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { createCircleGateway } from "./circle-gateway.ts";
import { parseUsdc, type Usdc } from "./money.ts";
import { createUnlinkClient } from "./privacy.ts";
import {
  createUnlinkTransport,
  loadLiveUnlinkTransport,
  type UnlinkSdk,
} from "./unlink-transport.ts";

const WITHDRAW_HASH = ("0x" + "11".repeat(32)) as Hex;
const PAY_HASH = ("0x" + "22".repeat(32)) as Hex;
const TRANSFER_HASH = ("0x" + "33".repeat(32)) as Hex;
const FAUCET_HASH = ("0x" + "44".repeat(32)) as Hex;

// A UnlinkSdk stub that records the call order across its methods.
const recordingSdk = () => {
  const order: string[] = [];
  const withdrawn: Usdc[] = [];
  const sdk: UnlinkSdk = {
    privateTransfer: () => {
      order.push("privateTransfer");
      return Promise.resolve({ hash: TRANSFER_HASH });
    },
    faucetPrivateTokens: () => {
      order.push("faucet");
      return Promise.resolve({ hash: FAUCET_HASH });
    },
    withdraw: ({ amount }) => {
      order.push("withdraw");
      withdrawn.push(amount);
      return Promise.resolve({ hash: WITHDRAW_HASH });
    },
  };
  return { sdk, order, withdrawn };
};

const recordingGateway = () => {
  const order: string[] = [];
  return {
    order,
    gateway: createCircleGateway({
      transport: {
        pay: () => {
          order.push("pay");
          return Promise.resolve({ hash: PAY_HASH });
        },
      },
    }),
  };
};

describe("createUnlinkTransport.payX402", () => {
  test("withdraws from the shielded pool BEFORE paying the resource", async () => {
    const seq: string[] = [];
    const withdrawn: Usdc[] = [];
    const unlink: UnlinkSdk = {
      privateTransfer: () => Promise.resolve({ hash: TRANSFER_HASH }),
      faucetPrivateTokens: () => Promise.resolve({ hash: FAUCET_HASH }),
      withdraw: ({ amount }) => {
        seq.push("withdraw");
        withdrawn.push(amount);
        return Promise.resolve({ hash: WITHDRAW_HASH });
      },
    };
    const gateway = createCircleGateway({
      transport: {
        pay: () => {
          seq.push("pay");
          return Promise.resolve({ hash: PAY_HASH });
        },
      },
    });
    const transport = createUnlinkTransport({ unlink, gateway });
    const res = await transport.payX402({
      fromUnlinkAddress: "unlink1abc",
      url: "https://api.example.com/x402/r",
      amount: parseUsdc("0.5"),
    });
    expect(res.hash).toBe(PAY_HASH); // returns the SETTLEMENT hash, not the withdraw
    expect(seq).toEqual(["withdraw", "pay"]);
    expect(withdrawn).toEqual([parseUsdc("0.5")]);
  });

  test("private tips + faucet pass straight through to Unlink", async () => {
    const { sdk } = recordingSdk();
    const { gateway } = recordingGateway();
    const transport = createUnlinkTransport({ unlink: sdk, gateway });
    expect(
      (await transport.privateTransfer({
        fromUnlinkAddress: "unlink1a",
        toUnlinkAddress: "unlink1b",
        amount: parseUsdc("1"),
      })).hash
    ).toBe(TRANSFER_HASH);
    expect(
      (await transport.faucetPrivateTokens({ toUnlinkAddress: "unlink1a", amount: parseUsdc("5") }))
        .hash
    ).toBe(FAUCET_HASH);
  });
});

describe("createUnlinkClient gating with the live transport", () => {
  const build = (gatewayConfigured: boolean) => {
    const { sdk } = recordingSdk();
    const { gateway } = recordingGateway();
    return createUnlinkClient({
      apiKey: "k",
      transport: createUnlinkTransport({ unlink: sdk, gateway }),
      gatewayConfigured,
    });
  };

  test("payX402 works when the gateway leg is configured", async () => {
    const client = build(true);
    expect(client.available).toBe(true);
    const res = await client.payX402({
      fromUnlinkAddress: "unlink1a",
      url: "https://x.example.com/r",
      amount: parseUsdc("1"),
    });
    expect(res.hash).toBe(PAY_HASH);
  });

  test("payX402 rejects when the gateway leg is NOT configured (tips still fine)", async () => {
    const client = build(false);
    await expect(
      client.payX402({ fromUnlinkAddress: "u", url: "https://x.example.com/r", amount: parseUsdc("1") })
    ).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });
    // a private tip on the same client still works
    expect(
      (await client.privateTransfer({ fromUnlinkAddress: "a", toUnlinkAddress: "b", amount: parseUsdc("1") }))
        .hash
    ).toBe(TRANSFER_HASH);
  });
});

describe("loadLiveUnlinkTransport", () => {
  test("returns null without the full key set (degrades to public/PAYMENT_REQUIRED)", () => {
    expect(loadLiveUnlinkTransport({})).toBeNull();
    expect(loadLiveUnlinkTransport({ UNLINK_API_KEY: "k" })).toBeNull();
  });

  test("returns null even with keys set — live SDK wiring is deferred to §23", () => {
    expect(
      loadLiveUnlinkTransport({
        UNLINK_API_KEY: "k",
        CIRCLE_GATEWAY_API_KEY: "c",
        ARC_PAYER_EOA_KEY: "0xabc",
      })
    ).toBeNull();
  });
});
