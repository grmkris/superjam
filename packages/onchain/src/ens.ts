// ENS adapter (§16) — Durin L2Registry on Base Sepolia. TWO-LEVEL naming
// (§11): user nodes under the parent (`username.superjam.eth`), jam nodes under
// users (`slug.username.superjam.eth`). Writes go through the sole privileged
// signer; reads (the chain-sourced catalog) through the public client.
//
// EVERYTHING here is degrade-safe: writes throw OnchainError("ENS_WRITE_FAILED")
// so the caller (S's build pipeline, registration) try/catches and an ENS
// failure NEVER fails a build (§11 step 5). The exact Durin ABI/events are
// "live docs win" (§0.4) — confirmed at the §23 rehearsal; the SEAM signatures
// (mintApp / ensureUserNode / listFromEns) are what S and %67 import and stay
// fixed.
import {
  type Address,
  type Hex,
  type PublicClient,
  concat,
  keccak256,
  labelhash,
} from "viem";
import { OnchainError } from "./errors.ts";
import type { ServerWallet } from "./server-wallet.ts";

// Minimal Durin L2Registry ABI (verify exact shapes at §23).
export const L2_REGISTRY_ABI = [
  {
    type: "function",
    name: "createSubnode",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parentNode", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ name: "node", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "NewSubname",
    inputs: [
      { name: "node", type: "bytes32", indexed: true },
      { name: "label", type: "string", indexed: false },
    ],
  },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";

const failEns = (e: unknown): never => {
  throw new OnchainError("ENS_WRITE_FAILED", String(e));
};

/** ENS subnode hash: keccak256(parentNode ‖ labelhash(label)) — the namehash
 *  recursion, computed from the parent NODE so we never need the parent name. */
export const subnode = (parent: Hex, label: string): Hex =>
  keccak256(concat([parent, labelhash(label)]));

export interface EnsConfig {
  registryAddress: Address;
  /** namehash("superjam.eth") (§1 ENS_PARENT_NODE). */
  parentNode: Hex;
  /** Parent name for assembling display names + url records. */
  parentName: string;
  /** Registry deploy block — the getLogs floor for listFromEns. */
  deployBlock?: bigint;
}

/** Text records set on a jam node. `app.category`/`app.remixOf` keep the chain
 *  feed's categories + remix provenance (§16). */
export interface AppEnsRecords {
  url: string;
  description?: string;
  avatar?: string;
  category?: string;
  remixOf?: string;
}

export interface MintAppParams {
  slug: string;
  username: string;
  owner: Address;
  records: AppEnsRecords;
}

export interface EnsCatalogRow {
  name: string;
  label: string;
  node: Hex;
  url?: string;
  description?: string;
  avatar?: string;
  category?: string;
  remixOf?: string;
}

const recordEntries = (r: AppEnsRecords): [string, string][] =>
  (
    [
      ["url", r.url],
      ["description", r.description],
      ["avatar", r.avatar],
      ["app.category", r.category],
      ["app.remixOf", r.remixOf],
    ] as [string, string | undefined][]
  ).filter((e): e is [string, string] => Boolean(e[1]));

// In-memory catalog cache (§16 — 60s), keyed by registry address.
const CATALOG_TTL_MS = 60_000;
const catalogCache = new Map<string, { at: number; rows: EnsCatalogRow[] }>();

export const createEns = (
  client: PublicClient,
  serverWallet: ServerWallet,
  config: EnsConfig
) => {
  const readText = async (node: Hex, key: string): Promise<string> => {
    try {
      return (await client.readContract({
        address: config.registryAddress,
        abi: L2_REGISTRY_ABI,
        functionName: "text",
        args: [node, key],
      })) as string;
    } catch {
      return "";
    }
  };

  const ownerOf = async (node: Hex): Promise<Address> => {
    try {
      return (await client.readContract({
        address: config.registryAddress,
        abi: L2_REGISTRY_ABI,
        functionName: "owner",
        args: [node],
      })) as Address;
    } catch {
      return ZERO;
    }
  };

  const setRecords = async (node: Hex, records: AppEnsRecords): Promise<void> => {
    // Sequenced (one signer); a multicall is a later optimization.
    for (const [key, value] of recordEntries(records)) {
      await serverWallet.writeContract({
        address: config.registryAddress,
        abi: L2_REGISTRY_ABI,
        functionName: "setText",
        args: [node, key, value],
      });
    }
  };

  return {
    /** Ensure `username.<parent>` exists; mints it (idempotent) if not. */
    async ensureUserNode(
      username: string,
      owner: Address
    ): Promise<{ name: string; node: Hex; minted: boolean }> {
      const node = subnode(config.parentNode, username);
      const existing = await ownerOf(node);
      if (existing !== ZERO) {
        return { name: `${username}.${config.parentName}`, node, minted: false };
      }
      try {
        await serverWallet.writeContract({
          address: config.registryAddress,
          abi: L2_REGISTRY_ABI,
          functionName: "createSubnode",
          args: [config.parentNode, username, owner, []],
        });
      } catch (e) {
        return failEns(e);
      }
      return { name: `${username}.${config.parentName}`, node, minted: true };
    },

    /** Mint `slug.username.<parent>` under the user node + set its records.
     *  Ensures the user node first. Returns the ENS name + the mint tx hash. */
    async mintApp(
      params: MintAppParams
    ): Promise<{ ensName: string; node: Hex; txHash: Hex }> {
      const { node: userNode } = await this.ensureUserNode(
        params.username,
        params.owner
      );
      const node = subnode(userNode, params.slug);
      let txHash: Hex;
      try {
        txHash = await serverWallet.writeContract({
          address: config.registryAddress,
          abi: L2_REGISTRY_ABI,
          functionName: "createSubnode",
          args: [userNode, params.slug, params.owner, []],
        });
      } catch (e) {
        return failEns(e);
      }
      await setRecords(node, params.records);
      return {
        ensName: `${params.slug}.${params.username}.${config.parentName}`,
        node,
        txHash,
      };
    },

    /** The chain-sourced catalog (§16): walk NewSubname logs, resolve text
     *  records, cache 60s. Backs the feed — delete the DB, this survives. */
    async listFromEns(): Promise<EnsCatalogRow[]> {
      const key = config.registryAddress.toLowerCase();
      const cached = catalogCache.get(key);
      // Date.now is fine at runtime (not a workflow script).
      const now = Date.now();
      if (cached && now - cached.at < CATALOG_TTL_MS) return cached.rows;

      const logs = await client.getLogs({
        address: config.registryAddress,
        event: L2_REGISTRY_ABI[4],
        fromBlock: config.deployBlock ?? 0n,
        toBlock: "latest",
      });

      const rows: EnsCatalogRow[] = [];
      for (const log of logs) {
        const node = log.args.node as Hex | undefined;
        const label = log.args.label as string | undefined;
        if (!node || !label) continue;
        const [url, description, avatar, category, remixOf] = [
          await readText(node, "url"),
          await readText(node, "description"),
          await readText(node, "avatar"),
          await readText(node, "app.category"),
          await readText(node, "app.remixOf"),
        ];
        rows.push({
          // Best-effort display name from the label; the `url` record is the
          // authoritative web link (two-level reconstruction needs the event's
          // parentNode — verify the Durin event shape at §23).
          name: `${label}.${config.parentName}`,
          label,
          node,
          url: url || undefined,
          description: description || undefined,
          avatar: avatar || undefined,
          category: category || undefined,
          remixOf: remixOf || undefined,
        });
      }
      catalogCache.set(key, { at: now, rows });
      return rows;
    },
  };
};

export type Ens = ReturnType<typeof createEns>;
