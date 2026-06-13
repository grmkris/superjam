// P2 — fund the server wallet's Circle Gateway channel on Arc (the x402 escrow).
// Circle batching settles from the PAYER's Gateway balance, keyed by depositor ==
// signer. This deposits USDC from the server wallet's own Arc balance into the
// Gateway Wallet (approve → deposit), then polls the off-chain available balance
// until it's spendable (there's a finalization delay).
//
//   Run from the repo root (Bun auto-loads .env):
//     bun run apps/server/scripts/gateway-deposit.ts [amountUSDC=5]
//
// Needs the signer's creds in env: DYNAMIC_* for the 0x159b MPC wallet (which holds
// the Arc USDC), else SERVER_WALLET_PRIVATE_KEY for the raw-key fallback. Moves real
// testnet USDC.
import { formatUnits, parseUnits } from "viem";
import {
  ARC_USDC,
  GATEWAY_WALLET,
  arcPublicClient,
  buildServerWallet,
  gatewayAvailable,
  usdcBalance,
} from "./_wallet.ts";

const APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const DEPOSIT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const amountStr = process.argv[2] ?? "5";
const amount = parseUnits(amountStr, 6);

const wallet = await buildServerWallet();
const pc = arcPublicClient();

const bal = await usdcBalance(pc, wallet.address);
if (bal < amount) {
  throw new Error(
    `Insufficient Arc USDC on ${wallet.address}: have ${formatUnits(bal, 6)}, need ${amountStr}. ` +
      `(The 12.98 USDC is on the Dynamic wallet 0x159b — set DYNAMIC_* env to use it.)`
  );
}

const alreadyAvail = await gatewayAvailable(wallet.address).catch(() => 0n);
console.log(`current Gateway available: ${formatUnits(alreadyAvail, 6)} USDC`);

console.log(`\n1/2 approving ${amountStr} USDC → GatewayWallet ${GATEWAY_WALLET}…`);
const approveHash = await wallet.writeContract({
  address: ARC_USDC,
  abi: APPROVE_ABI,
  functionName: "approve",
  args: [GATEWAY_WALLET, amount],
});
console.log(`    approve tx: ${approveHash}`);

console.log(`2/2 depositing ${amountStr} USDC into the Gateway channel…`);
const depositHash = await wallet.writeContract({
  address: GATEWAY_WALLET,
  abi: DEPOSIT_ABI,
  functionName: "deposit",
  args: [ARC_USDC, amount],
});
console.log(`    deposit tx: ${depositHash}`);

const target = alreadyAvail + amount;
console.log(`\npolling Gateway available until ≥ ${formatUnits(target, 6)} USDC (finalization delay)…`);
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 15_000));
  const avail = await gatewayAvailable(wallet.address).catch(() => 0n);
  console.log(`  [${i}] available: ${formatUnits(avail, 6)} USDC`);
  if (avail >= target) {
    console.log(`\n✅ channel funded. ${wallet.address} can now x402-pay on Arc.`);
    process.exit(0);
  }
}
console.log(
  "\n⏳ not available yet — deposit is on-chain (see deposit tx); the off-chain balance may need a few more confirmations. Re-run with amount 0… or just re-check later."
);
