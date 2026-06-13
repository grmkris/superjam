// CLI smoke test for the Unlink SDK on arc-testnet (NOT committed / not part of the
// gate). Confirms the real @unlink-xyz/sdk@0.3.0-canary.598 works live with our creds:
//   bun run packages/onchain/scripts/unlink-smoke.ts
// Reads .env: UNLINK_API_KEY, SERVER_WALLET_PRIVATE_KEY, optional UNLINK_APP_ID.
import { createUnlinkAdmin } from "@unlink-xyz/sdk/admin";
import { account, createUnlinkClient, evm } from "@unlink-xyz/sdk/client";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

const ENV = "arc-testnet";
const CHAIN_ID = 5042002;
const APP_ID = process.env.UNLINK_APP_ID || "superjam";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const apiKey = process.env.UNLINK_API_KEY as string;
const key = process.env.SERVER_WALLET_PRIVATE_KEY as `0x${string}`;

const show = (label: string, v: unknown) =>
  console.log(label, typeof v === "object" ? JSON.stringify(v, null, 0) : v);

async function main() {
  console.log("env:", ENV, "appId:", APP_ID, "apiKey set:", Boolean(apiKey), "key set:", Boolean(key));

  console.log("\n[1] createUnlinkAdmin…");
  const admin = createUnlinkAdmin({ environment: ENV, apiKey });
  console.log("    ok; admin keys:", Object.keys(admin));

  console.log("\n[2] account.fromEthereumSignature (stable server account)…");
  const signer = privateKeyToAccount(key);
  const signature = await signer.signMessage({
    message: "SuperJam Unlink server account v1",
  });
  const acct = account.fromEthereumSignature({ signature, appId: APP_ID, chainId: CHAIN_ID });
  console.log("    acct keys:", Object.keys(acct));
  // @ts-expect-error probe shape
  show("    acct.address:", acct.address ?? acct.unlinkAddress);

  console.log("\n[3] createUnlinkClient…");
  const client = createUnlinkClient({
    environment: ENV,
    account: acct,
    authorizationToken: {
      provider: async (ctx) => {
        const t = await admin.authorizationTokens.issue({
          subjectType: "unlink_address",
          unlinkAddress: ctx.unlinkAddress,
        });
        // @ts-expect-error probe AuthorizationToken shape
        return { token: t.token ?? t.value ?? t, expiresAt: t.expiresAt ?? t.expires_at };
      },
    },
    register: (payload) => admin.users.register(payload),
  });
  const addr = await client.getAddress();
  console.log("    client unlink address:", addr);

  console.log("\n[4] ensureRegistered…");
  await client.ensureRegistered();
  console.log("    registered ok");

  console.log("\n[5] getBalances (before faucet)…");
  show("   ", await client.getBalances());

  console.log("\n[6] depositWithApproval 0.1 USDC (public→private, real 0x3600)…");
  const walletClient = createWalletClient({ account: signer, chain: ARC, transport: http() });
  const publicClient = createPublicClient({ chain: ARC, transport: http() });
  const evmProvider = evm.fromViem({ walletClient, publicClient });
  const dep = await client.depositWithApproval({
    token: ARC_USDC,
    amount: "100000", // 0.1 USDC (6-dec)
    evm: evmProvider,
  });
  show("    deposit handle:", { keys: Object.keys(dep) });
  const depResult = await dep.wait();
  show("    deposit result:", depResult);

  console.log("\n[7] getBalances (after deposit)…");
  show("   ", await client.getBalances());

  console.log("\n[8] private transfer 0.02 → a 2nd derived account…");
  const acct2 = account.fromEthereumSignature({ signature, appId: APP_ID, chainId: CHAIN_ID, accountIndex: 1 });
  const client2 = createUnlinkClient({
    environment: ENV,
    account: acct2,
    authorizationToken: {
      provider: async (ctx) => {
        const t = await admin.authorizationTokens.issue({
          subjectType: "unlink_address",
          unlinkAddress: ctx.unlinkAddress,
        });
        // @ts-expect-error probe shape
        return { token: t.token ?? t, expiresAt: t.expiresAt ?? t.expires_at };
      },
    },
    register: (payload) => admin.users.register(payload),
  });
  const recipient = await client2.getAddress();
  await client2.ensureRegistered();
  console.log("    recipient:", recipient);
  const tr = await client.transfer({ token: ARC_USDC, amount: "20000", recipientAddress: recipient });
  show("    transfer result:", await tr.wait());
  show("    sender balances:", await client.getBalances());
  show("    recipient balances:", await client2.getBalances());

  console.log("\n✅ UNLINK SMOKE OK — deposit + private transfer proven live on Arc");
}

main().catch((e) => {
  console.error("\n❌ SMOKE FAILED at:", e?.message || String(e));
  if (e?.code) console.error("   code:", e.code);
  if (e?.cause) console.error("   cause:", JSON.stringify(e.cause)?.slice(0, 400));
  process.exit(1);
});
