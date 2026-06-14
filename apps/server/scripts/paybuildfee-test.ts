// Test B — the FULL private flow, exactly what builds.payBuildFee does:
//   onchain.unlink.payX402 = withdraw from the user's Unlink SHIELDED balance
//   (private leg) → Circle Gateway x402-pay the builder (settlement leg).
// Standalone (no server/DB): a test user is a raw key; the gateway signer is the
// Dynamic server wallet 0x159b (its funded channel settles the payment).
//
//   bun run apps/server/scripts/paybuildfee-test.ts [builderUrl] [amountUSDC=0.01]
//
// The test user = ARC_PAYER_EOA_KEY (a funded EOA). Moves real testnet USDC.
import {
  createCircleGateway,
  createArcX402Signer,
  createLiveCircleGatewayTransport,
  createUnlinkTransport,
  formatUsdc,
  parseUsdc,
} from "@superjam/onchain";
import { createUserUnlink } from "@superjam/onchain/unlink-user";
import { privateKeyToAccount } from "viem/accounts";
import { buildServerWallet } from "./_wallet.ts";

const BUILDER_URL = process.argv[2] ?? "https://sjbuilder.37.60.232.68.sslip.io/";
const amount = parseUsdc(process.argv[3] ?? "0.01");

const testKey = process.env.ARC_PAYER_EOA_KEY;
if (!testKey) throw new Error("ARC_PAYER_EOA_KEY not set (the test user)");
const testAccount = privateKeyToAccount(testKey as `0x${string}`);
console.log("test user EOA:", testAccount.address);

// 1) the user's per-user Unlink (shielded) account
const userUnlink = await createUserUnlink({
  apiKey: process.env.UNLINK_API_KEY!,
  account: testAccount,
  rpcUrl: process.env.ARC_RPC_URL,
});
console.log("unlinkAddress:", userUnlink.unlinkAddress);

const shielded = async () => {
  const bals = await userUnlink.getBalances();
  const total = bals.reduce((a, b) => a + BigInt(b.amount), 0n);
  return total;
};
let bal = await shielded();
console.log("shielded balance:", formatUsdc(bal), "USDC");

// 2) ensure the shielded balance covers the payment; deposit (public→private) if not
if (bal < amount) {
  console.log(`shielding ${formatUsdc(amount * 5n)} USDC (public → private) …`);
  const dep = await userUnlink.deposit(amount * 5n);
  console.log("  deposit tx:", dep);
  bal = await shielded();
  console.log("shielded balance now:", formatUsdc(bal), "USDC");
  if (bal < amount) throw new Error("deposit did not land enough shielded balance");
}

// 3) the gateway signer = the Dynamic server wallet (its channel settles the pay)
const serverWallet = await buildServerWallet();
if (!serverWallet.account) throw new Error("server wallet has no account");
const signer = createArcX402Signer(serverWallet.account, process.env.ARC_RPC_URL);

// 4) compose the live transport (the real payBuildFee path)
const transport = createUnlinkTransport({
  unlink: {
    privateTransfer: async (a) => ({
      hash: await userUnlink.privateTransfer(a.toUnlinkAddress, a.amount),
    }),
    faucetPrivateTokens: async (a) => ({
      hash: await userUnlink.privateTransfer(a.toUnlinkAddress, a.amount),
    }),
    // the private leg: unshield the user's USDC to the server wallet
    withdraw: async (a) => ({
      hash: await userUnlink.withdraw(serverWallet.address, a.amount),
    }),
  },
  gateway: createCircleGateway({
    transport: createLiveCircleGatewayTransport({ signer }),
  }),
});

// 5) pay: withdraw-from-shielded (PRIVATE) → Circle Gateway settle (the builder)
console.log(`\npayX402 ${formatUsdc(amount)} USDC → ${BUILDER_URL} …`);
const { hash } = await transport.payX402({
  fromUnlinkAddress: userUnlink.unlinkAddress,
  url: BUILDER_URL,
  amount,
});
console.log(`\n✅ settlement: ${hash}`);

const after = await shielded();
console.log("shielded balance after:", formatUsdc(after), "USDC",
  `(Δ ${formatUsdc(after - bal)})  ← the private leg`);
