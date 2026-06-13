import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { createMockOnchain } from "../testing/onchain-mock.ts";
import { createAgentIdentity } from "./agent-identity-impl.ts";
import { createAgentReputation } from "./agent-reputation-impl.ts";

describe("createAgentIdentity.provision (live, over onchain)", () => {
  test("returns the ENSv2 name and the ERC-8004 id", async () => {
    const identity = createAgentIdentity(createMockOnchain());
    const res = await identity.provision({
      agentId: "ba_1",
      slug: "forge",
      ownerUsername: "maria",
      ownerWallet: "0x" + "1".repeat(40),
      walletAddress: "0x" + "a".repeat(40),
    });
    expect(res.ensName).toBe("forge.superjam.eth"); // ENSv2 flat subname
    expect(res.erc8004Id).toBe("8004:ba_1");
  });

  test("still registers ERC-8004 when there's no owner wallet (no ENS)", async () => {
    const identity = createAgentIdentity(createMockOnchain());
    const res = await identity.provision({
      agentId: "ba_2",
      slug: "speedy",
      ownerUsername: "neo",
      ownerWallet: undefined,
      walletAddress: "0x" + "b".repeat(40),
    });
    expect(res.ensName).toBeUndefined();
    expect(res.erc8004Id).toBe("8004:ba_2");
  });
});

describe("createAgentReputation.recordReview (live, over onchain)", () => {
  test("calls writeReputation with the rating + a text hash", async () => {
    const calls: { erc8004Id: string; rating: number; textHash: Hex }[] = [];
    const onchain = createMockOnchain();
    onchain.writeReputation = async (p) => {
      calls.push(p);
      return ("0x" + "ef".repeat(32)) as Hex;
    };
    await createAgentReputation(onchain).recordReview({
      erc8004Id: "7",
      rating: 5,
      text: "great jam",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.erc8004Id).toBe("7");
    expect(calls[0]!.rating).toBe(5);
    expect(calls[0]!.textHash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
