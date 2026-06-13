// LIVE Unlink private-rail proof (the HYBRID per-user model). Proves createUserUnlink
// end-to-end on arc-testnet: derive+register two users → user1 deposits native USDC
// (public→private) → user1 privately transfers to user2 → user2's shielded balance
// rises. NOT part of the JS gate: `.itest.ts` + gated by RUN_ONCHAIN_INTEGRATION=1.
//   UNLINK_API_KEY=<key> RUN_ONCHAIN_INTEGRATION=1 \
//     bun test ./packages/onchain/integration/unlink.itest.ts
// Reads .env: SERVER_WALLET_PRIVATE_KEY (user1, funded EVM), UNLINK_API_KEY, ARC_RPC_URL.
import { beforeAll, describe, expect, test } from "bun:test";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseUsdc } from "../src/money.ts";
import { type UserUnlink, createUserUnlink } from "../src/unlink-user.ts";

const RUN = process.env.RUN_ONCHAIN_INTEGRATION === "1" && Boolean(process.env.UNLINK_API_KEY);
const suite = RUN ? describe : describe.skip;
// A well-known throwaway key (anvil #1) — only used to derive a stable RECIPIENT
// Unlink address (it never needs EVM funds; it only receives privately).
const RECIPIENT_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const TWO_MIN = 120_000;

const bal = (b: { token: string; amount: string }[]): bigint =>
  b.reduce((acc, x) => acc + BigInt(x.amount), 0n);

suite("live Unlink per-user private rail (real shielded txs on Arc)", () => {
  let sender: UserUnlink;
  let recipient: UserUnlink;

  beforeAll(async () => {
    const apiKey = process.env.UNLINK_API_KEY as string;
    const rpcUrl = process.env.ARC_RPC_URL;
    sender = await createUserUnlink({
      apiKey,
      account: privateKeyToAccount(process.env.SERVER_WALLET_PRIVATE_KEY as Hex),
      rpcUrl,
    });
    recipient = await createUserUnlink({
      apiKey,
      account: privateKeyToAccount(RECIPIENT_KEY),
      rpcUrl,
    });
  }, TWO_MIN);

  test("derives + registers two distinct Unlink accounts", () => {
    expect(sender.unlinkAddress).toMatch(/^unlink1/);
    expect(recipient.unlinkAddress).toMatch(/^unlink1/);
    expect(sender.unlinkAddress).not.toBe(recipient.unlinkAddress);
  });

  test(
    "deposit (public→private) raises the sender's shielded balance",
    async () => {
      const before = bal(await sender.getBalances());
      await sender.deposit(parseUsdc("0.05"));
      const after = bal(await sender.getBalances());
      expect(after - before).toBe(parseUsdc("0.05"));
    },
    TWO_MIN
  );

  test(
    "private transfer moves shielded USDC sender → recipient",
    async () => {
      const rBefore = bal(await recipient.getBalances());
      await sender.privateTransfer(recipient.unlinkAddress, parseUsdc("0.02"));
      const rAfter = bal(await recipient.getBalances());
      expect(rAfter - rBefore).toBe(parseUsdc("0.02"));
    },
    TWO_MIN
  );
});
