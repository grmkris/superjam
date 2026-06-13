// Test A — the x402 settlement leg, ISOLATED (no Unlink). Builds the x402-paid
// client with the server-wallet signer (Circle batching) and pays the builder's
// `POST /` hire resource on Arc, drawing from the server wallet's Gateway channel
// (fund it first with gateway-deposit.ts). Proves: channel + the builder x402
// resource + the batching scheme + Arc settlement — the bounty's core, no Unlink.
//
//   bun run apps/server/scripts/x402-pay-test.ts [builderUrl] [agentWallet]
//
// It also measures WHERE the money lands (agent wallet vs agent Gateway balance) —
// that resolves Risk 1 (whether builds.create's verifyUsdcTransfer can match the
// settlement). Moves real testnet USDC.
import { createArcX402Signer, createLiveCircleGatewayTransport } from "@superjam/onchain";
import { formatUnits } from "viem";
import {
  arcPublicClient,
  buildServerWallet,
  gatewayAvailable,
  usdcBalance,
} from "./_wallet.ts";

const BUILDER_URL = process.argv[2] ?? "https://sjbuilder.37.60.232.68.sslip.io/";
const AGENT = (process.argv[3] ??
  "0x4e79f7c6b858a2753cA6D2402a0CDa68ACCb2Fc3") as `0x${string}`;

const wallet = await buildServerWallet();
if (!wallet.account) {
  throw new Error("server wallet has no viem `account` — cannot build the x402 signer");
}
const signer = createArcX402Signer(wallet.account, process.env.ARC_RPC_URL);
const pc = arcPublicClient();

const snap = async () => ({
  agentWallet: await usdcBalance(pc, AGENT),
  agentGateway: await gatewayAvailable(AGENT).catch(() => 0n),
  payerChannel: await gatewayAvailable(wallet.address).catch(() => 0n),
});
const fmt = (s: Awaited<ReturnType<typeof snap>>) => ({
  agentWallet: formatUnits(s.agentWallet, 6),
  agentGateway: formatUnits(s.agentGateway, 6),
  payerChannel: formatUnits(s.payerChannel, 6),
});

const before = await snap();
console.log("payer:", wallet.address, "| agent:", AGENT);
console.log("before:", fmt(before));
if (before.payerChannel === 0n) {
  console.warn("⚠️  payer Gateway channel is 0 — run gateway-deposit.ts first, settle will fail.");
}

console.log(`\nx402-paying ${BUILDER_URL} …`);
const transport = createLiveCircleGatewayTransport({ signer });
const { hash } = await transport.pay({ url: BUILDER_URL });
console.log(`\n✅ settlement tx: ${hash}`);
console.log(`   Arc explorer: https://explorer.testnet.arc.network/tx/${hash}`);

await new Promise((r) => setTimeout(r, 8_000));
const after = await snap();
console.log("after: ", fmt(after));
console.log("deltas:", {
  agentWallet: formatUnits(after.agentWallet - before.agentWallet, 6),
  agentGateway: formatUnits(after.agentGateway - before.agentGateway, 6),
  payerChannel: formatUnits(after.payerChannel - before.payerChannel, 6),
});
console.log(
  "\nRisk-1 read: if the agent GATEWAY balance rose but the agent WALLET didn't, the\n" +
    "settlement credits the Gateway ledger (seller withdraws later) — so builds.create's\n" +
    "verifyUsdcTransfer({ expectedTo: agentWallet }) would NOT match a real settlement."
);
