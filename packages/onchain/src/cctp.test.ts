// CCTP V2 pure-logic tests (no chain): domain ids, bytes32 padding, and the Iris
// attestation poller's success/timeout behaviour (mock fetch + sleep). The live
// burn→mint flow is exercised by the gated integration test, not here.
import { describe, expect, mock, test } from "bun:test";
import { encodeAbiParameters } from "viem";
import {
  CCTP_DOMAIN,
  CCTP_V2,
  FINALITY_STANDARD,
  createCctp,
  fetchAttestation,
  toBytes32,
} from "./cctp.ts";
import { parseUsdc } from "./money.ts";

describe("cctp constants + helpers", () => {
  test("domains: Base Sepolia 6, Arc 26", () => {
    expect(CCTP_DOMAIN.baseSepolia).toBe(6);
    expect(CCTP_DOMAIN.arcTestnet).toBe(26);
  });

  test("toBytes32 left-pads a 20-byte address", () => {
    const a = "0x000000000000000000000000000000000000dEaD" as const;
    expect(toBytes32(a).toLowerCase()).toBe(
      "0x000000000000000000000000000000000000000000000000000000000000dead"
    );
  });

  test("V2 contracts are the documented CREATE2 addresses", () => {
    expect(CCTP_V2.tokenMessenger).toBe("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");
    expect(FINALITY_STANDARD).toBe(2000);
  });
});

describe("fetchAttestation (Iris poller)", () => {
  const burnTx = `0x${"a".repeat(64)}` as const;
  const noSleep = async () => {};

  test("returns message+attestation once status=complete (polls past pending)", async () => {
    let calls = 0;
    const fetchImpl = mock(async () => {
      calls += 1;
      // first poll: still pending; second: complete.
      const status = calls < 2 ? "pending_confirmations" : "complete";
      const attestation = calls < 2 ? "0x" : "0xfeed";
      return {
        ok: true,
        json: async () => ({ messages: [{ status, message: "0xmsg", attestation }] }),
      };
    });
    const r = await fetchAttestation(6, burnTx, { fetchImpl, sleepMs: noSleep });
    expect(r).toEqual({ message: "0xmsg" as never, attestation: "0xfeed" as never });
    expect(calls).toBe(2);
  });

  test("throws RELAY_FAILED after maxAttempts of no attestation", async () => {
    const fetchImpl = mock(async () => ({
      ok: true,
      json: async () => ({ messages: [] }),
    }));
    await expect(
      fetchAttestation(6, burnTx, { fetchImpl, sleepMs: noSleep, maxAttempts: 3 })
    ).rejects.toMatchObject({ code: "RELAY_FAILED" });
  });
});

describe("bridge() routing — plain vs hook", () => {
  const irisOk = {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        messages: [{ status: "complete", message: "0xmsg", attestation: "0xatt" }],
      }),
    }),
  };
  const mkEndpoint = (chain: "baseSepolia" | "arcTestnet", calls: string[]) =>
    ({
      chain,
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      account: { address: "0x0000000000000000000000000000000000000001" },
      walletClient: {
        chain: {},
        writeContract: mock(async (a: { functionName: string; address: string }) => {
          calls.push(`${a.functionName}@${a.address}`);
          return `0x${"1".repeat(64)}`;
        }),
      },
      publicClient: { waitForTransactionReceipt: mock(async () => ({})) },
    }) as never;

  test("hookData ⇒ depositForBurnWithHook on source + relay on the hook receiver", async () => {
    const calls: string[] = [];
    const cctp = createCctp({
      source: mkEndpoint("baseSepolia", calls),
      dest: mkEndpoint("arcTestnet", calls),
      iris: irisOk,
    });
    await cctp.bridge({
      amount: parseUsdc("0.05"),
      mintRecipient: "0x00000000000000000000000000000000000000aa" as never,
      hookData: encodeAbiParameters(
        [{ type: "address" }],
        ["0x00000000000000000000000000000000000000bb"]
      ),
    });
    expect(calls.some((c) => c.startsWith("approve@"))).toBe(true);
    expect(calls.some((c) => c.startsWith("depositForBurnWithHook@"))).toBe(true);
    // dest leg calls relay on the hook (mintRecipient), NOT receiveMessage.
    expect(
      calls.some((c) => c.startsWith("relay@0x00000000000000000000000000000000000000aa"))
    ).toBe(true);
    expect(calls.some((c) => c.startsWith("receiveMessage@"))).toBe(false);
  });

  test("no hookData ⇒ depositForBurn + receiveMessage (unchanged path)", async () => {
    const calls: string[] = [];
    const cctp = createCctp({
      source: mkEndpoint("baseSepolia", calls),
      dest: mkEndpoint("arcTestnet", calls),
      iris: irisOk,
    });
    await cctp.bridge({
      amount: parseUsdc("0.05"),
      mintRecipient: "0x00000000000000000000000000000000000000aa" as never,
    });
    expect(calls.some((c) => c.startsWith("depositForBurn@"))).toBe(true);
    expect(calls.some((c) => c.startsWith("depositForBurnWithHook@"))).toBe(false);
    expect(calls.some((c) => c.startsWith("receiveMessage@"))).toBe(true);
    expect(calls.some((c) => c.startsWith("relay@"))).toBe(false);
  });
});
