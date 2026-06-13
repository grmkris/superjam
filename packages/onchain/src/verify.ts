// The public-rail trust root (§12). ONE verifier reused by every provable
// check — publish fee, pot stake, paid build. It reads the ERC-20 *Transfer
// LOG*, NEVER `tx.from`: a relayed EIP-3009 tx (§15.1) has an outer
// `from = relayer` while the Transfer log keeps the signer's address. Matching
// on the log is what makes gasless relay and direct transfers branch-agnostic.
import { isAddressEqual, parseEventLogs } from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { USDC, type ChainKey } from "./chains.ts";
import { OnchainError } from "./errors.ts";
import { type Usdc, usdc } from "./money.ts";

const ERC20_TRANSFER_EVENT = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export interface VerifyTransferParams {
  hash: Hex;
  chain: ChainKey;
  /** The address funds must land at (treasury / escrow / agent wallet). */
  expectedTo: Address;
  /** Minimum acceptable amount (publish fee, stake, build price). */
  minAmount: Usdc;
}

export interface VerifiedTransfer {
  /** The PAYER — taken from the Transfer log, i.e. the signer even when relayed. */
  from: Address;
  value: Usdc;
}

/** Verify an on-chain USDC transfer by its receipt's Transfer log. Throws an
 *  `OnchainError` if the tx reverted or no qualifying transfer is present.
 *  Replay (a reused hash) is guarded by the DB unique index on `txHash` in the
 *  api layer — this function is stateless. */
export const verifyUsdcTransfer = async (
  client: PublicClient,
  { hash, chain, expectedTo, minAmount }: VerifyTransferParams
): Promise<VerifiedTransfer> => {
  const token = USDC[chain];
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new OnchainError("RECEIPT_REVERTED", `tx ${hash} did not succeed`);
  }

  // Decode every Transfer event in the receipt, then keep only those emitted by
  // the USDC contract (a tx may touch many tokens). `parseEventLogs` skips logs
  // that don't match the ABI, so unrelated logs are ignored safely.
  const transfers = parseEventLogs({
    abi: ERC20_TRANSFER_EVENT,
    eventName: "Transfer",
    logs: receipt.logs,
  }).filter((log) => isAddressEqual(log.address, token.address));

  const match = transfers.find(
    (t) => isAddressEqual(t.args.to, expectedTo) && t.args.value >= minAmount
  );
  if (!match) {
    throw new OnchainError(
      "TRANSFER_NOT_FOUND",
      `no USDC transfer ≥ ${minAmount} to ${expectedTo} in ${hash}`
    );
  }

  return { from: match.args.from, value: usdc(match.args.value) };
};

/** Read a USDC balance (6-dec base units) on the given chain. Reads the ERC-20
 *  `balanceOf` — on Arc this is the SAME balance as the 18-dec native unit, so
 *  we read this ONE source and never sum (§15). */
export const usdcBalanceOf = async (
  client: PublicClient,
  chain: ChainKey,
  account: Address
): Promise<Usdc> => {
  const token = USDC[chain];
  const raw = (await client.readContract({
    address: token.address,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
  return usdc(raw);
};
