#!/usr/bin/env bun
// Diagnose + fund the platform faucet pool (§23). `payments.addFunds(arcTestnet)`
// → `unlink.faucet` → a PRIVATE transfer from THIS pool's SHIELDED balance to the
// user. The pool = the ARC_PAYER_EOA's Unlink account; its shielded balance must be
// pre-funded (deposit public USDC → shielded) or every faucet/top-up rejects
// ("Couldn't add funds"). The EOA's PUBLIC USDC is the deposit source.
//
//   diagnose (read shielded balance only):
//     UNLINK_API_KEY=… ARC_PAYER_EOA_KEY=… ARC_RPC_URL=… bun apps/server/scripts/fund-faucet-pool.ts
//   fund N USDC (public → shielded):
//     … bun apps/server/scripts/fund-faucet-pool.ts 10
import { createUserUnlink } from "@superjam/onchain/unlink-user";
import { parseUsdc } from "@superjam/onchain";
import { privateKeyToAccount } from "viem/accounts";

const apiKey = process.env.UNLINK_API_KEY;
const faucetKey = process.env.ARC_PAYER_EOA_KEY;
const rpcUrl = process.env.ARC_RPC_URL;
if (!apiKey || !faucetKey) {
  console.error("set UNLINK_API_KEY + ARC_PAYER_EOA_KEY (+ ARC_RPC_URL)");
  process.exit(2);
}
const fundUsdc = process.argv[2]; // e.g. "10" to deposit; omit to just diagnose

const usd = (bs: { amount: string }[]) =>
  Number(bs.reduce((a, b) => a + BigInt(b.amount), 0n)) / 1e6;

const pool = await createUserUnlink({
  apiKey,
  account: privateKeyToAccount(faucetKey as `0x${string}`),
  rpcUrl,
});
console.log("faucet pool unlinkAddress:", pool.unlinkAddress);
const before = await pool.getBalances();
console.log("shielded balances (before):", before, "→ total:", usd(before), "USDC");

if (fundUsdc) {
  console.log(`\ndepositing ${fundUsdc} USDC (public → shielded pool)…`);
  const tx = await pool.deposit(parseUsdc(fundUsdc));
  console.log("deposit tx:", tx);
  const after = await pool.getBalances();
  console.log("shielded balances (after):", after, "→ total:", usd(after), "USDC");
} else {
  console.log("\n(diagnose only — pass an amount, e.g. `… 10`, to fund the pool)");
}
