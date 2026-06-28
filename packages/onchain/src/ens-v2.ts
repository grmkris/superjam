// ENSv2-native adapter (§16, the resolvable layer) — mints `<slug>.superjam.eth`
// natively in ENSv2 on Sepolia (L1) so jam names resolve in STANDARD ENS tooling
// (viem/ethers getEnsAddress, app.ens.domains), unlike the Durin L2 names (which
// stay the in-app / Basescan story, see ens.ts).
//
// HOW IT RESOLVES (verified live 2026-06-13): the UniversalResolverV2 walk
// (namechain LibRegistry.findResolver) goes rootRegistry."eth" -> EthRegistry
// (0xdedb)."superjam" -> getSubregistry -> SuperjamRegistry -> getResolver(slug)
// -> SuperjamRegistry -> addr(node). SuperjamRegistry (0x822f…, agent-owned) is
// ONE self-contained contract that is BOTH an IRegistry and the resolver. The
// EthRegistry's `superjam` entry was pointed at it via setSubregistry (one-time,
// by the superjam.eth owner). Minting a name = ONE `setSubname` call here.
//
// NESTED names `<slug>.<user>.superjam.eth` (MintV2Params.under) resolve via
// ENSIP-10 WILDCARD, not sub-registries: the deployed registry has no
// setSubregistry (getSubregistry is always 0), but it IS an IExtendedResolver
// (supportsInterface 0x9061b923). The walk descends to SuperjamRegistry, anchors
// the resolver at the registered `<user>` label, then 0x822f answers
// `resolve(…, addr(fullNode))`. So one `setSubname(slug, namehash(full), owner)`
// is enough — no per-user contract. Verified live 2026-06-13.
//
// Pure viem (web-bundle-safe, like ens.ts). Degrade-safe: writes throw
// OnchainError("ENS_WRITE_FAILED") so the build pipeline try/catches and an ENS
// failure NEVER fails a build (§11 step 5).
import { type Address, type Hex, type PublicClient, namehash } from "viem";
import { OnchainError } from "./errors.ts";
import type { ServerWallet } from "./server-wallet.ts";

// SuperjamRegistry ABI — the subset we call. Source + deploy: a single
// self-contained IRegistry+resolver contract owned by the platform agent.
// Verified live on Sepolia (guestbook.superjam.eth resolves through it).
export const SUPERJAM_REGISTRY_ABI = [
  {
    type: "function",
    name: "setSubname",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "node", type: "bytes32" },
      { name: "a", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "val", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getResolver",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export interface EnsV2Config {
  /** The SuperjamRegistry (IRegistry + resolver) address on Sepolia. */
  registry: Address;
  /** Parent name the slugs live under. Default "superjam.eth". */
  parentName?: string;
}

export interface MintV2Params {
  slug: string;
  owner: Address;
  records?: { url?: string };
  /** Nest the name under this user label → `<slug>.<under>.<parent>` (e.g.
   *  `tip-jar.kristjangrm1.superjam.eth`). Omit for a flat `<slug>.<parent>`.
   *  Nested names resolve via ENSIP-10 wildcard: the walk anchors the resolver at
   *  the (already-registered) `<under>` node, then `0x822f` (an IExtendedResolver)
   *  answers `resolve(…, addr(fullNode))`. So nesting needs only this one
   *  `setSubname` — no per-user sub-registry (the deployed registry has no
   *  setSubregistry). Verified live 2026-06-13. The `<under>` label MUST already be
   *  registered (claimUsername mints it) or the wildcard has no anchor. */
  under?: string;
}

export interface MintV2Result {
  ensName: string;
  node: Hex;
  txHash: Hex;
}

/** Build the ENSv2 mint adapter. `serverWallet` MUST be bound to Sepolia and own
 *  the SuperjamRegistry (the agent). `publicClient` reads Sepolia. */
export const createEnsV2 = (
  publicClient: PublicClient,
  serverWallet: ServerWallet,
  cfg: EnsV2Config
) => {
  const parentName = cfg.parentName ?? "superjam.eth";

  return {
    /** Mint (or re-point) `<slug>.superjam.eth` -> owner, natively in ENSv2.
     *  One tx; optionally a second for the url text record. Returns the name. */
    async mintSubname({ slug, owner, records, under }: MintV2Params): Promise<MintV2Result> {
      const ensName = under ? `${slug}.${under}.${parentName}` : `${slug}.${parentName}`;
      const node = namehash(ensName);
      let txHash: Hex;
      try {
        txHash = await serverWallet.writeContract({
          address: cfg.registry,
          abi: SUPERJAM_REGISTRY_ABI,
          functionName: "setSubname",
          args: [slug, node, owner],
        });
        if (records?.url) {
          await serverWallet.writeContract({
            address: cfg.registry,
            abi: SUPERJAM_REGISTRY_ABI,
            functionName: "setText",
            args: [node, "url", records.url],
          });
        }
      } catch (err) {
        throw new OnchainError("ENS_WRITE_FAILED", String(err));
      }
      return { ensName, node, txHash };
    },

    /** Read the address record (resolution check / catalog). */
    async addr(slug: string): Promise<Address> {
      const node = namehash(`${slug}.${parentName}`);
      return publicClient.readContract({
        address: cfg.registry,
        abi: SUPERJAM_REGISTRY_ABI,
        functionName: "addr",
        args: [node],
      });
    },
  };
};

export type EnsV2 = ReturnType<typeof createEnsV2>;
