// ERC-8004 "Trustless Agents" bindings (§14/§16) — the typed wrapper the platform
// calls to give a builder agent a real on-chain identity + reputation, against the
// CANONICAL reference registries (erc-8004/erc-8004-contracts), already deployed on
// Base Sepolia at deterministic CREATE2 addresses (same as Sepolia):
//   IdentityRegistry   0x8004A818BFB912233c491871b3d84c89A494BD9e  (ERC-721 agent NFTs)
//   ReputationRegistry 0x8004B663056A597Dffe9eCcC1965A193B7388713  (feedback signals)
// We DON'T deploy anything — we bind to the standard. Writes go through C's
// ServerWallet (the sole privileged signer); reads through the Base-Sepolia client.
//
// Self-feedback guard: ReputationRegistry rejects `giveFeedback` from the agent
// NFT's owner/operator. So on register we mint (to the server wallet, the only
// signer) and TRANSFER the NFT to the builder's wallet — the builder genuinely
// owns their agent identity, and the platform (server wallet, now neutral) can
// write the reputation feedback its reviews produce.
import { type Address, type Hex, type PublicClient, parseEventLogs } from "viem";
import { OnchainError } from "./errors.ts";
import type { ServerWallet } from "./server-wallet.ts";

/** Canonical reference-registry addresses (Base Sepolia / Sepolia, CREATE2). */
export const ERC8004_IDENTITY_BASE_SEPOLIA: Address =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const ERC8004_REPUTATION_BASE_SEPOLIA: Address =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713";

export interface Erc8004Config {
  /** ERC-8004 IdentityRegistry (ERC-721). */
  identityRegistry: Address;
  /** ERC-8004 ReputationRegistry. Defaults to the canonical paired address. */
  reputationRegistry?: Address;
}

// Minimal ABI fragments — only the surface we call (viem matches by name+args).
const IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

const REPUTATION_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "aggregateValue", type: "int128" },
      { name: "decimals", type: "uint8" },
    ],
  },
] as const;

/** Our feedback is tagged so getSummary can filter to platform-written reviews. */
const FEEDBACK_TAG = "superjam";

export interface RegisterAgentIdentityParams {
  /** The api builderAgent id (for the agent URI fallback / logging). */
  agentId: string;
  /** The agent's ENS name — the on-chain agent URI when present. */
  ensName?: string;
  /** The agent's wallet — receives the identity NFT (so the platform stays neutral). */
  walletAddress: string;
  ownerWallet?: string;
}

export interface WriteReputationParams {
  /** The on-chain ERC-8004 agent id (decimal string). */
  erc8004Id: string;
  /** 1-5. */
  rating: number;
  /** keccak256 of the review text. */
  textHash: Hex;
}

export interface ReputationSummary {
  count: number;
  /** Mean rating (aggregateValue / count), 1-5. */
  average: number;
}

export const createErc8004 = (
  client: PublicClient,
  serverWallet: ServerWallet,
  config: Erc8004Config
) => {
  const identity = config.identityRegistry;
  const reputation = config.reputationRegistry ?? ERC8004_REPUTATION_BASE_SEPOLIA;

  return {
    /** Mint the agent's ERC-8004 identity NFT and hand it to the builder. */
    async registerAgentIdentity(
      p: RegisterAgentIdentityParams
    ): Promise<{ erc8004Id: string; txHash: Hex }> {
      const agentURI = p.ensName ?? `superjam:agent:${p.agentId}`;
      const txHash = await serverWallet.writeContract({
        address: identity,
        abi: IDENTITY_ABI,
        functionName: "register",
        args: [agentURI],
      });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      const [registered] = parseEventLogs({
        abi: IDENTITY_ABI,
        eventName: "Registered",
        logs: receipt.logs,
      });
      if (!registered) {
        throw new OnchainError(
          "ERC8004_WRITE_FAILED",
          "register() emitted no Registered event"
        );
      }
      const erc8004Id = (registered.args.agentId as bigint).toString();

      // Transfer the NFT to the builder so the platform can write neutral
      // feedback (the registry forbids owner self-feedback). transferFrom (not
      // safe) — never reverts on a non-receiver wallet.
      await serverWallet.writeContract({
        address: identity,
        abi: IDENTITY_ABI,
        functionName: "transferFrom",
        args: [serverWallet.address, p.walletAddress as Address, registered.args.agentId],
      });

      return { erc8004Id, txHash };
    },

    /** Record a verified review as ERC-8004 feedback (rating + text hash). */
    writeReputation(p: WriteReputationParams): Promise<Hex> {
      return serverWallet.writeContract({
        address: reputation,
        abi: REPUTATION_ABI,
        functionName: "giveFeedback",
        args: [
          BigInt(p.erc8004Id),
          BigInt(p.rating),
          0,
          FEEDBACK_TAG,
          "",
          "",
          "",
          p.textHash,
        ],
      });
    },

    /** Aggregate the platform-written feedback for an agent (for the profile). */
    async readReputation(erc8004Id: string): Promise<ReputationSummary> {
      const [count, aggregate, decimals] = (await client.readContract({
        address: reputation,
        abi: REPUTATION_ABI,
        functionName: "getSummary",
        args: [BigInt(erc8004Id), [serverWallet.address], FEEDBACK_TAG, ""],
      })) as readonly [bigint, bigint, number];
      const n = Number(count);
      const scale = 10 ** Number(decimals);
      const average = n === 0 ? 0 : Number(aggregate) / scale / n;
      return { count: n, average };
    },
  };
};

export type Erc8004 = ReturnType<typeof createErc8004>;
