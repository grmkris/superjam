// The public-rail trust root, tested at the code seam (mock viem client, §0.2)
// — no env flags. The load-bearing case: a relayed EIP-3009 tx whose OUTER
// from is the relayer but whose Transfer log keeps the signer's address must be
// ACCEPTED, returning the signer (§12/§15.1).
import { describe, expect, test } from "bun:test";
import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  encodeEventTopics,
} from "viem";
import { USDC } from "./chains.ts";
import { OnchainError } from "./errors.ts";
import { parseUsdc } from "./money.ts";
import { verifyUsdcTransfer } from "./verify.ts";

const TRANSFER_ABI = [
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

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const RELAYER = "0x2222222222222222222222222222222222222222" as Address;
const TREASURY = "0x3333333333333333333333333333333333333333" as Address;
const OTHER_TOKEN = "0x9999999999999999999999999999999999999999" as Address;
const HASH = "0xabc" as Hex;

type Transfer = { from: Address; to: Address; value: bigint; token?: Address };

const transferLog = ({ from, to, value, token }: Transfer) => ({
  address: token ?? USDC.baseSepolia.address,
  topics: encodeEventTopics({
    abi: TRANSFER_ABI,
    eventName: "Transfer",
    args: { from, to },
  }),
  data: encodeAbiParameters([{ type: "uint256" }], [value]),
  blockNumber: 1n,
  blockHash: "0x0",
  logIndex: 0,
  transactionHash: HASH,
  transactionIndex: 0,
  removed: false,
});

// A mock client whose receipt carries the given logs. `tx.from` is deliberately
// the relayer — the verifier must never read it.
const mockClient = (
  transfers: Transfer[],
  status: "success" | "reverted" = "success"
): PublicClient =>
  ({
    getTransactionReceipt: async () => ({
      status,
      from: RELAYER,
      logs: transfers.map(transferLog),
    }),
  }) as unknown as PublicClient;

const verify = (client: PublicClient, minAmount = parseUsdc("1")) =>
  verifyUsdcTransfer(client, {
    hash: HASH,
    chain: "baseSepolia",
    expectedTo: TREASURY,
    minAmount,
  });

describe("verifyUsdcTransfer", () => {
  test("ACCEPTS a relayed EIP-3009 transfer — returns the log signer, not tx.from", async () => {
    // Outer tx submitted by RELAYER; Transfer log from = SIGNER.
    const client = mockClient([
      { from: SIGNER, to: TREASURY, value: parseUsdc("1") },
    ]);
    const result = await verify(client);
    expect(result.from).toBe(SIGNER);
    expect(result.value).toBe(parseUsdc("1"));
  });

  test("accepts an over-payment (value > min)", async () => {
    const client = mockClient([
      { from: SIGNER, to: TREASURY, value: parseUsdc("5") },
    ]);
    expect((await verify(client)).value).toBe(parseUsdc("5"));
  });

  test("rejects the wrong recipient", async () => {
    const client = mockClient([
      { from: SIGNER, to: OTHER_TOKEN, value: parseUsdc("1") },
    ]);
    await expect(verify(client)).rejects.toMatchObject({
      code: "TRANSFER_NOT_FOUND",
    });
  });

  test("rejects an underpayment (value < min)", async () => {
    const client = mockClient([
      { from: SIGNER, to: TREASURY, value: parseUsdc("0.5") },
    ]);
    await expect(verify(client, parseUsdc("1"))).rejects.toBeInstanceOf(
      OnchainError
    );
  });

  test("ignores a Transfer from a different token contract", async () => {
    const client = mockClient([
      // right amount/recipient but wrong token → must not satisfy the check.
      { from: SIGNER, to: TREASURY, value: parseUsdc("1"), token: OTHER_TOKEN },
    ]);
    await expect(verify(client)).rejects.toMatchObject({
      code: "TRANSFER_NOT_FOUND",
    });
  });

  test("rejects a reverted receipt", async () => {
    const client = mockClient(
      [{ from: SIGNER, to: TREASURY, value: parseUsdc("1") }],
      "reverted"
    );
    await expect(verify(client)).rejects.toMatchObject({
      code: "RECEIPT_REVERTED",
    });
  });

  test("picks the qualifying transfer among several", async () => {
    const client = mockClient([
      { from: RELAYER, to: OTHER_TOKEN, value: parseUsdc("9") },
      { from: SIGNER, to: TREASURY, value: parseUsdc("2") },
    ]);
    const result = await verify(client);
    expect(result.from).toBe(SIGNER);
    expect(result.value).toBe(parseUsdc("2"));
  });
});
