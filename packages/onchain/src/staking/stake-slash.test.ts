import { describe, expect, test } from "bun:test";
import type { Address, Hex, PublicClient } from "viem";
import { keccak256, toHex } from "viem";
import { usdc } from "../money.ts";
import type { ServerWallet, WriteContractArgs } from "../server-wallet.ts";
import { buildKey, createStakeSlash } from "./stake-slash.ts";

const CONTRACT = "0x00000000000000000000000000000000000000c0" as Address;
const BUILDER = "0x1111111111111111111111111111111111111111" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// A ServerWallet stub that records writes and returns a deterministic hash.
const recordingWallet = () => {
  const writes: WriteContractArgs[] = [];
  const wallet: ServerWallet = {
    address: "0x000000000000000000000000000000000000a111" as Address,
    relayTransfer: () => Promise.reject(new Error("unused")),
    sendUsdc: () => Promise.reject(new Error("unused")),
    writeContract: (args) => {
      writes.push(args);
      return Promise.resolve(("0x" + "ab".repeat(32)) as Hex);
    },
  };
  return { wallet, writes };
};

// A PublicClient stub whose readContract returns a scripted value per function.
const readingClient = (
  table: Partial<Record<string, unknown>>
): PublicClient =>
  ({
    readContract: ({ functionName }: { functionName: string }) =>
      Promise.resolve(table[functionName]),
  }) as unknown as PublicClient;

describe("buildKey", () => {
  test("hashes the api build id to the contract bytes32 key", () => {
    expect(buildKey("bld_abc")).toBe(keccak256(toHex("bld_abc")));
  });
});

describe("createStakeSlash writes (through the server wallet)", () => {
  test("registerBuild locks the bond + escrows the price", async () => {
    const { wallet, writes } = recordingWallet();
    const ss = createStakeSlash({
      address: CONTRACT,
      serverWallet: wallet,
      publicClient: readingClient({}),
    });
    const hash = await ss.registerBuild("bld_1", BUILDER, usdc(1_000_000n), usdc(5_000_000n));
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.address).toBe(CONTRACT);
    expect(writes[0]!.functionName).toBe("registerBuild");
    expect(writes[0]!.args).toEqual([buildKey("bld_1"), BUILDER, 1_000_000n, 5_000_000n]);
  });

  test("markDelivered + resolve carry the right args", async () => {
    const { wallet, writes } = recordingWallet();
    const ss = createStakeSlash({
      address: CONTRACT,
      serverWallet: wallet,
      publicClient: readingClient({}),
    });
    await ss.markDelivered("bld_1");
    await ss.resolve("bld_1", true, true);
    expect(writes[0]!.functionName).toBe("markDelivered");
    expect(writes[0]!.args).toEqual([buildKey("bld_1")]);
    expect(writes[1]!.functionName).toBe("resolve");
    expect(writes[1]!.args).toEqual([buildKey("bld_1"), true, true]);
  });
});

describe("createStakeSlash reads", () => {
  test("freeStake returns branded Usdc", async () => {
    const ss = createStakeSlash({
      address: CONTRACT,
      serverWallet: recordingWallet().wallet,
      publicClient: readingClient({ stake: 7_500_000n }),
    });
    expect(await ss.freeStake(BUILDER)).toBe(usdc(7_500_000n));
  });

  test("getBuild maps the struct, status enum, and zero challenger → null", async () => {
    const ss = createStakeSlash({
      address: CONTRACT,
      serverWallet: recordingWallet().wallet,
      publicClient: readingClient({
        builds: [BUILDER, 1_000_000n, 5_000_000n, 2, 1718000000n, ZERO, 0n],
      }),
    });
    const b = await ss.getBuild("bld_1");
    expect(b).toEqual({
      builder: BUILDER,
      price: usdc(1_000_000n),
      bond: usdc(5_000_000n),
      status: "delivered",
      deliveredAt: 1718000000,
      challenger: null,
      challengeBond: usdc(0n),
    });
  });

  test("getBuild returns null for an unregistered build (status none)", async () => {
    const ss = createStakeSlash({
      address: CONTRACT,
      serverWallet: recordingWallet().wallet,
      publicClient: readingClient({
        builds: [ZERO, 0n, 0n, 0, 0n, ZERO, 0n],
      }),
    });
    expect(await ss.getBuild("bld_missing")).toBeNull();
  });

  test("getBuild surfaces an active challenger", async () => {
    const challenger = "0x2222222222222222222222222222222222222222" as Address;
    const ss = createStakeSlash({
      address: CONTRACT,
      serverWallet: recordingWallet().wallet,
      publicClient: readingClient({
        builds: [BUILDER, 1_000_000n, 5_000_000n, 2, 1718000000n, challenger, 5_000_000n],
      }),
    });
    const b = await ss.getBuild("bld_1");
    expect(b!.challenger).toBe(challenger);
    expect(b!.challengeBond).toBe(usdc(5_000_000n));
  });
});
