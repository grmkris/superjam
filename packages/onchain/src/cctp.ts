// CCTP V2 — chain-abstracted USDC (Circle bounty #2: "Arc as a liquidity hub").
// Burn native USDC on a source chain (Ethereum Sepolia L1) → Circle's Iris attests →
// mint native USDC on Arc, optionally with `hookData` that atomically deposits into
// the StakeSlash escrow on arrival. One user action sources USDC from any CCTP chain
// into the Arc builder economy — a single liquidity surface.
//
// Clients are injected (testable/mockable); the real cross-chain run is slow (Iris
// attestation ~minutes) so live exercise is gated, not part of the JS gate.
import {
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  pad,
} from "viem";
import { type ChainKey } from "./chains.ts";
import { OnchainError } from "./errors.ts";
import { type Usdc } from "./money.ts";

// CCTP V2 testnet contracts — same CREATE2 address on every chain (verified
// 2026-06-13, developers.circle.com/cctp/evm-smart-contracts).
export const CCTP_V2 = {
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address,
  messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address,
  tokenMinter: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192" as Address,
} as const;

/** CCTP domain ids (NOT chain ids). Ethereum Sepolia = 0, Arc testnet = 26. */
export const CCTP_DOMAIN: Record<ChainKey, number> = {
  sepolia: 0,
  arcTestnet: 26,
};

export const IRIS_SANDBOX_URL = "https://iris-api-sandbox.circle.com";

/** Minimal fetch shape (real `fetch` + test mocks both satisfy it). */
export type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

// Standard transfer = finalized (2000); fast = confirmed (≤1000, may carry a fee).
export const FINALITY_STANDARD = 2000;
export const FINALITY_FAST = 1000;

const TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const MESSAGE_TRANSMITTER_ABI = [
  { type: "event", name: "MessageSent", inputs: [{ name: "message", type: "bytes", indexed: false }] },
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// CctpEscrowHook (Arc) — the destination hook receiver: receiveMessage's the
// mint to itself, then decodes hookData (a builder address) and deposits the
// minted USDC into StakeSlash as that builder's stake. See packages/contracts.
const ESCROW_HOOK_ABI = [
  {
    type: "function",
    name: "relay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [
      { name: "builder", type: "address" },
      { name: "minted", type: "uint256" },
    ],
  },
] as const;

/** A 20-byte address as the bytes32 CCTP expects (left-padded). */
export const toBytes32 = (addr: Address): Hex => pad(addr, { size: 32 });

export interface CctpEndpoint {
  chain: ChainKey;
  usdc: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
}

export interface BridgeParams {
  amount: Usdc;
  /** Recipient of the freshly-minted USDC on the destination (wallet or escrow).
   *  When `hookData` is set this MUST be the destination hook contract
   *  (CctpEscrowHook) — it receives the mint, then executes the hook. */
  mintRecipient: Address;
  /** Standard (finalized) by default — no fee on testnet. */
  finalityThreshold?: number;
  /** Opaque CCTP V2 hook payload, executed by the destination receiver after the
   *  mint (bounty #2 atomic deposit-into-escrow). For CctpEscrowHook this is
   *  `encodeAbiParameters([{type:"address"}], [builder])`. Triggers
   *  `depositForBurnWithHook` instead of `depositForBurn`. */
  hookData?: Hex;
}

/** Fetch attestation from Iris for a source-domain + burn tx. Resolves once
 *  status === "complete". `fetchImpl`/`sleep` injected for testability. */
export const fetchAttestation = async (
  sourceDomain: number,
  burnTxHash: Hex,
  opts: {
    irisBaseUrl?: string;
    fetchImpl?: FetchLike;
    sleepMs?: (ms: number) => Promise<void>;
    maxAttempts?: number;
  } = {}
): Promise<{ message: Hex; attestation: Hex }> => {
  const base = opts.irisBaseUrl ?? IRIS_SANDBOX_URL;
  const f: FetchLike = opts.fetchImpl ?? ((url) => fetch(url));
  const sleep = opts.sleepMs ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const url = `${base}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  const maxAttempts = opts.maxAttempts ?? 60; // ~minutes
  for (let i = 0; i < maxAttempts; i++) {
    const res = await f(url);
    if (res.ok) {
      const body = (await res.json()) as {
        messages?: { status: string; message: Hex; attestation: Hex }[];
      };
      const m = body.messages?.[0];
      if (m && m.status === "complete" && m.attestation !== "0x") {
        return { message: m.message, attestation: m.attestation };
      }
    }
    await sleep(5000);
  }
  throw new OnchainError("RELAY_FAILED", `CCTP attestation timed out for ${burnTxHash}`);
};

export const createCctp = ({
  source,
  dest,
  iris,
}: {
  source: CctpEndpoint;
  dest: CctpEndpoint;
  iris?: { irisBaseUrl?: string; fetchImpl?: FetchLike };
}) => ({
  /** Burn on source → attest → mint on dest. Returns both tx hashes. */
  async bridge(params: BridgeParams): Promise<{ burnTxHash: Hex; mintTxHash: Hex }> {
    const finality = params.finalityThreshold ?? FINALITY_STANDARD;
    // 1) approve USDC to the TokenMessenger on the source chain. MUST wait for
    //    the receipt — depositForBurn estimates/executes against current state,
    //    so an un-mined approve ⇒ "transfer amount exceeds allowance" revert.
    const approveTxHash = await source.walletClient.writeContract({
      account: source.account,
      chain: source.walletClient.chain,
      address: source.usdc,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [CCTP_V2.tokenMessenger, params.amount],
    });
    await source.publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    // 2) depositForBurn (+ optional hookData) → emits MessageSent. With a hook,
    //    mintRecipient is the destination receiver (CctpEscrowHook) that mints
    //    then executes the hook (bounty #2 atomic deposit-into-escrow).
    const ZERO_CALLER = toBytes32("0x0000000000000000000000000000000000000000");
    const burnTxHash = params.hookData
      ? await source.walletClient.writeContract({
          account: source.account,
          chain: source.walletClient.chain,
          address: CCTP_V2.tokenMessenger,
          abi: TOKEN_MESSENGER_ABI,
          functionName: "depositForBurnWithHook",
          args: [
            params.amount,
            CCTP_DOMAIN[dest.chain],
            toBytes32(params.mintRecipient),
            source.usdc,
            ZERO_CALLER,
            0n,
            finality,
            params.hookData,
          ],
        })
      : await source.walletClient.writeContract({
          account: source.account,
          chain: source.walletClient.chain,
          address: CCTP_V2.tokenMessenger,
          abi: TOKEN_MESSENGER_ABI,
          functionName: "depositForBurn",
          args: [
            params.amount,
            CCTP_DOMAIN[dest.chain],
            toBytes32(params.mintRecipient),
            source.usdc,
            ZERO_CALLER, // any caller
            0n, // maxFee (0 for standard/finalized)
            finality,
          ],
        });
    await source.publicClient.waitForTransactionReceipt({ hash: burnTxHash });
    // 3) Iris attestation (slow).
    const { message, attestation } = await fetchAttestation(
      CCTP_DOMAIN[source.chain],
      burnTxHash,
      iris
    );
    // 4) Settle on dest. Plain transfer → receiveMessage on the MessageTransmitter
    //    (mints to mintRecipient). Hook flow → call the receiver's `relay`, which
    //    internally receiveMessage's (minting to itself) THEN executes the hook
    //    (decodes hookData → deposits into the escrow). mintRecipient = the hook.
    const mintTxHash = params.hookData
      ? await dest.walletClient.writeContract({
          account: dest.account,
          chain: dest.walletClient.chain,
          address: params.mintRecipient, // the CctpEscrowHook receiver
          abi: ESCROW_HOOK_ABI,
          functionName: "relay",
          args: [message, attestation],
        })
      : await dest.walletClient.writeContract({
          account: dest.account,
          chain: dest.walletClient.chain,
          address: CCTP_V2.messageTransmitter,
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [message, attestation],
        });
    await dest.publicClient.waitForTransactionReceipt({ hash: mintTxHash });
    return { burnTxHash, mintTxHash };
  },
});
