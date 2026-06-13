// ENS adapter at the seam (§16, mock viem clients). mintApp ensures the user
// node then mints the jam node + sets app.* records; ensureUserNode is
// idempotent; listFromEns walks NewSubname logs into catalog rows.
import { beforeEach, describe, expect, test } from "bun:test";
import type { Address, Hex, PublicClient } from "viem";
import { createEns, subnode } from "./ens.ts";
import type { ServerWallet } from "./server-wallet.ts";

const REGISTRY = "0x00000000000000000000000000000000000re61" as Address;
const PARENT = `0x${"11".repeat(32)}` as Hex; // namehash("superjam.eth")
const OWNER = "0x000000000000000000000000000000000000aaaa" as Address;
const ZERO = "0x0000000000000000000000000000000000000000";

const config = {
  registryAddress: REGISTRY,
  parentNode: PARENT,
  parentName: "superjam.eth",
  deployBlock: 0n,
};

interface MockState {
  owners: Map<string, Address>; // node → owner (absent ⇒ ZERO)
  texts: Map<string, string>; // `${node}:${key}` → value
  logs: { args: { node: Hex; label: string } }[];
}

const writes: { functionName: string; args: readonly unknown[] }[] = [];

const mockClient = (s: MockState): PublicClient =>
  ({
    readContract: async ({ functionName, args }: any) => {
      if (functionName === "owner") return s.owners.get(args[0]) ?? ZERO;
      if (functionName === "text") return s.texts.get(`${args[0]}:${args[1]}`) ?? "";
      return "";
    },
    getLogs: async () => s.logs,
  }) as unknown as PublicClient;

const mockWallet: ServerWallet = {
  address: OWNER,
  relayTransfer: async () => `0x${"0".repeat(64)}` as Hex,
  sendUsdc: async () => `0x${"0".repeat(64)}` as Hex,
  writeContract: async ({ functionName, args }) => {
    writes.push({ functionName, args });
    return `0x${(writes.length).toString(16).padStart(64, "0")}` as Hex;
  },
};

beforeEach(() => {
  writes.length = 0;
});

describe("ens adapter", () => {
  test("subnode = keccak(parent ‖ labelhash(label)); deterministic", () => {
    expect(subnode(PARENT, "alice")).toBe(subnode(PARENT, "alice"));
    expect(subnode(PARENT, "alice")).not.toBe(subnode(PARENT, "bob"));
  });

  test("mintApp: mints user node + jam node + sets app.* records", async () => {
    const s: MockState = { owners: new Map(), texts: new Map(), logs: [] };
    const ens = createEns(mockClient(s), mockWallet, config);

    const res = await ens.mintApp({
      slug: "tip-jar",
      username: "alice",
      owner: OWNER,
      records: { url: "https://superjam.fun/app/tip-jar", category: "tool", remixOf: "x.eth" },
    });
    expect(res.ensName).toBe("tip-jar.alice.superjam.eth");

    // 1 createSubnode (user) + 1 createSubnode (jam) + 3 setText (url, category, remixOf).
    const creates = writes.filter((w) => w.functionName === "createSubnode");
    const sets = writes.filter((w) => w.functionName === "setText");
    expect(creates).toHaveLength(2);
    expect(sets).toHaveLength(3);
    const keys = sets.map((w) => w.args[1]);
    expect(keys).toEqual(["url", "app.category", "app.remixOf"]);
  });

  test("ensureUserNode is idempotent — existing node is not re-minted", async () => {
    const userNode = subnode(PARENT, "alice");
    const s: MockState = {
      owners: new Map([[userNode, OWNER]]),
      texts: new Map(),
      logs: [],
    };
    const ens = createEns(mockClient(s), mockWallet, config);
    const r = await ens.ensureUserNode("alice", OWNER);
    expect(r.minted).toBe(false);
    expect(writes).toHaveLength(0); // no mint tx
  });

  test("mintApp on an existing user node mints only the jam node", async () => {
    const userNode = subnode(PARENT, "alice");
    const s: MockState = {
      owners: new Map([[userNode, OWNER]]),
      texts: new Map(),
      logs: [],
    };
    const ens = createEns(mockClient(s), mockWallet, config);
    await ens.mintApp({
      slug: "g",
      username: "alice",
      owner: OWNER,
      records: { url: "https://superjam.fun/app/g" },
    });
    expect(writes.filter((w) => w.functionName === "createSubnode")).toHaveLength(1);
  });

  test("listFromEns walks NewSubname logs → catalog rows with records", async () => {
    const node = subnode(subnode(PARENT, "alice"), "tip-jar");
    const s: MockState = {
      owners: new Map(),
      texts: new Map([
        [`${node}:url`, "https://superjam.fun/app/tip-jar"],
        [`${node}:app.category`, "tool"],
      ]),
      logs: [{ args: { node, label: "tip-jar" } }],
    };
    const ens = createEns(mockClient(s), mockWallet, {
      ...config,
      registryAddress: "0x00000000000000000000000000000000feed0001" as Address,
    });
    const rows = await ens.listFromEns();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("tip-jar");
    expect(rows[0]!.url).toBe("https://superjam.fun/app/tip-jar");
    expect(rows[0]!.category).toBe("tool");
    expect(rows[0]!.description).toBeUndefined();
  });
});
