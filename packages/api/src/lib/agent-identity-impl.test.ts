import { describe, expect, test } from "bun:test";
import type { Onchain } from "@superjam/onchain";
import type { Hex } from "viem";
import { createAgentIdentity } from "./agent-identity-impl.ts";

const OWNER = "0x" + "a".repeat(40);

// Minimal Onchain stub — only mintApp matters here.
const onchainWith = (
  mintApp: Onchain["mintApp"]
): Onchain => ({ mintApp }) as unknown as Onchain;

const baseInput = {
  agentId: "bag_1",
  slug: "maria-art-builder",
  ownerUsername: "maria",
  ownerWallet: OWNER,
  walletAddress: "0x" + "b".repeat(40),
};

describe("createAgentIdentity.provision", () => {
  test("mints slug.username.superjam.eth under the owner and returns ensName", async () => {
    const calls: unknown[] = [];
    const identity = createAgentIdentity(
      onchainWith((params) => {
        calls.push(params);
        return Promise.resolve({
          ensName: `${params.slug}.${params.username}.superjam.eth`,
          node: ("0x" + "c".repeat(64)) as Hex,
          txHash: ("0x" + "d".repeat(64)) as Hex,
        });
      })
    );
    const res = await identity.provision(baseInput);
    expect(res.ensName).toBe("maria-art-builder.maria.superjam.eth");
    expect(calls).toEqual([
      {
        slug: "maria-art-builder",
        username: "maria",
        owner: OWNER,
        records: { url: "https://superjam.fun/agents/maria-art-builder" },
      },
    ]);
  });

  test("skips (no mint) when the owner has no wallet", async () => {
    let called = false;
    const identity = createAgentIdentity(
      onchainWith(() => {
        called = true;
        return Promise.reject(new Error("should not be called"));
      })
    );
    const res = await identity.provision({ ...baseInput, ownerWallet: undefined });
    expect(res).toEqual({});
    expect(called).toBe(false);
  });

  test("best-effort: a mint failure resolves to {} (never throws)", async () => {
    const identity = createAgentIdentity(
      onchainWith(() => Promise.reject(new Error("ENS_WRITE_FAILED")))
    );
    await expect(identity.provision(baseInput)).resolves.toEqual({});
  });
});
