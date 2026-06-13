import { describe, expect, test } from "bun:test";
import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
} from "viem";
import { createErc8004 } from "./erc8004.ts";
import type { ServerWallet, WriteContractArgs } from "./server-wallet.ts";

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;
const SERVER = "0x000000000000000000000000000000000000a111" as Address;
const BUILDER = "0x1111111111111111111111111111111111111111" as Address;

const recordingWallet = () => {
  const writes: WriteContractArgs[] = [];
  const wallet: ServerWallet = {
    address: SERVER,
    relayTransfer: () => Promise.reject(new Error("unused")),
    sendUsdc: () => Promise.reject(new Error("unused")),
    writeContract: (args) => {
      writes.push(args);
      return Promise.resolve(("0x" + "ab".repeat(32)) as Hex);
    },
  };
  return { wallet, writes };
};

// A receipt carrying a real ABI-encoded Registered(agentId, agentURI, owner) log.
const REGISTERED = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"
);
const clientWithRegisteredId = (agentId: bigint, reads: Record<string, unknown> = {}) =>
  ({
    waitForTransactionReceipt: () =>
      Promise.resolve({
        status: "success",
        logs: [
          {
            address: IDENTITY,
            topics: encodeEventTopics({
              abi: [REGISTERED],
              eventName: "Registered",
              args: { agentId, owner: SERVER },
            }),
            data: encodeAbiParameters([{ type: "string" }], ["alice.superjam.eth"]),
          },
        ],
      }),
    readContract: ({ functionName }: { functionName: string }) =>
      Promise.resolve(reads[functionName]),
  }) as unknown as PublicClient;

describe("createErc8004", () => {
  test("registerAgentIdentity mints then transfers the NFT to the builder", async () => {
    const { wallet, writes } = recordingWallet();
    const erc = createErc8004(clientWithRegisteredId(7n), wallet, {
      identityRegistry: IDENTITY,
      reputationRegistry: REPUTATION,
    });
    const { erc8004Id } = await erc.registerAgentIdentity({
      agentId: "ba_x",
      ensName: "alice.superjam.eth",
      walletAddress: BUILDER,
    });
    expect(erc8004Id).toBe("7");
    expect(writes).toHaveLength(2);
    expect(writes[0]!.functionName).toBe("register");
    expect(writes[0]!.args).toEqual(["alice.superjam.eth"]);
    expect(writes[1]!.functionName).toBe("transferFrom");
    expect(writes[1]!.args).toEqual([SERVER, BUILDER, 7n]);
  });

  test("writeReputation calls giveFeedback as int128 rating with our tag", async () => {
    const { wallet, writes } = recordingWallet();
    const erc = createErc8004(clientWithRegisteredId(0n), wallet, {
      identityRegistry: IDENTITY,
    });
    const hash = await erc.writeReputation({
      erc8004Id: "7",
      rating: 5,
      textHash: ("0x" + "cd".repeat(32)) as Hex,
    });
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(writes[0]!.address).toBe(REPUTATION);
    expect(writes[0]!.functionName).toBe("giveFeedback");
    expect(writes[0]!.args).toEqual([
      7n,
      5n,
      0,
      "superjam",
      "",
      "",
      "",
      ("0x" + "cd".repeat(32)) as Hex,
    ]);
  });

  test("readReputation aggregates getSummary into a 1-5 average", async () => {
    const { wallet } = recordingWallet();
    const erc = createErc8004(
      clientWithRegisteredId(0n, { getSummary: [3n, 12n, 0] }),
      wallet,
      { identityRegistry: IDENTITY }
    );
    const summary = await erc.readReputation("7");
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(4); // 12 / 10^0 / 3
  });
});
