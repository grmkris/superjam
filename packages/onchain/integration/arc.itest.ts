// LIVE Arc integration proof (the "no mocks — be sure it works" capstone).
// NOT part of the JS gate: it's a `.itest.ts` (bun's default matcher ignores it)
// AND guarded by RUN_ONCHAIN_INTEGRATION=1. Run manually against real Arc:
//   RUN_ONCHAIN_INTEGRATION=1 bun test packages/onchain/integration/arc.itest.ts
// Reads creds from .env (bun auto-loads it): SERVER_WALLET_PRIVATE_KEY, optional
// ARC_RPC_URL (else the chain default rpc.testnet.arc.network).
import { describe, expect, test } from "bun:test";
import {
  PUBLIC_CHAIN,
  createOnchainFromConfig,
  parseUsdc,
} from "../src/index.ts";

const RUN = process.env.RUN_ONCHAIN_INTEGRATION === "1";
const suite = RUN ? describe : describe.skip;

// The funded server wallet (sole signer) + a real prior Arc transfer (the A0
// spike: 0.01 USDC → 0x…dEaD), whose receipt we re-verify through our TS layer.
const WALLET = "0x56592bA38D41370Fc0ebb43a02274709084c9904" as const;
const A0_TRANSFER =
  "0xa85633b6d2956e3483700dc704ff5b78ef180267696fe097d8588b44ff6dfd35" as const;
const BURNER = "0x000000000000000000000000000000000000dEaD" as const;

suite("live Arc onchain (real chain, real receipts)", () => {
  const onchain = RUN
    ? createOnchainFromConfig({
        serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
        arcRpcUrl: process.env.ARC_RPC_URL,
      })
    : null;

  test("createOnchainFromConfig builds a live Arc adapter", () => {
    expect(onchain).not.toBeNull(); // null ⇒ SERVER_WALLET_PRIVATE_KEY missing
    expect(onchain!.serverAddress.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  test("usdcBalance reads the wallet's real Arc USDC (funded)", async () => {
    const bal = await onchain!.usdcBalance(PUBLIC_CHAIN, WALLET);
    expect(bal > 0n).toBe(true); // funded with 20 USDC via the Circle faucet
  });

  test("verifyUsdcTransfer decodes a REAL Arc Transfer log (not tx.from)", async () => {
    const { from, value } = await onchain!.verifyUsdcTransfer({
      hash: A0_TRANSFER,
      chain: PUBLIC_CHAIN,
      expectedTo: BURNER,
      minAmount: parseUsdc("0.01"),
    });
    expect(from.toLowerCase()).toBe(WALLET.toLowerCase()); // the log signer
    expect(value).toBe(parseUsdc("0.01"));
  });

  test("rejects a transfer to the wrong recipient", async () => {
    await expect(
      onchain!.verifyUsdcTransfer({
        hash: A0_TRANSFER,
        chain: PUBLIC_CHAIN,
        expectedTo: WALLET, // the transfer went to BURNER, not here
        minAmount: parseUsdc("0.01"),
      })
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND" });
  });
});
