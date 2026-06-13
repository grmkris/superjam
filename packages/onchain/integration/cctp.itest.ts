// LIVE CCTP V2 cross-chain proof (Circle bounty #2: "Arc as a liquidity hub").
// Burns 0.05 USDC on Ethereum Sepolia (domain 0) → Iris sandbox attests → mints
// native USDC on Arc (domain 26). Pre-flight verified the CCTP V2 contracts ARE live
// on Arc (MessageTransmitter.localDomain() == 26, 2026-06-13). mintRecipient is OUR
// OWN wallet, so the bridged USDC returns to us — the only loss-case is a burn that
// never mints (bounded to the tiny amount). NB: needs USDC on Sepolia L1 to burn
// (Circle faucet: faucet.circle.com → Ethereum Sepolia).
//
// NOT part of the JS gate: `.itest.ts` (bun's default matcher ignores it) AND
// guarded by RUN_ONCHAIN_INTEGRATION=1. Iris attestation is slow (~minutes), so
// run it manually:
//   RUN_ONCHAIN_INTEGRATION=1 bun test packages/onchain/integration/cctp.itest.ts
// Reads .env (bun auto-loads): SERVER_WALLET_PRIVATE_KEY, SEPOLIA_RPC_URL,
// optional ARC_RPC_URL (else the chain default).
import { describe, expect, test } from "bun:test";
import {
  http,
  type Hex,
  createPublicClient,
  createWalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CCTP_SOURCE_CHAIN, CHAINS, USDC } from "../src/chains.ts";
import { createCctp } from "../src/cctp.ts";
import { parseUsdc } from "../src/money.ts";

const RUN = process.env.RUN_ONCHAIN_INTEGRATION === "1";
const suite = RUN ? describe : describe.skip;

const WALLET = "0x56592bA38D41370Fc0ebb43a02274709084c9904" as const;
const TEN_MIN = 600_000;

suite("live CCTP V2 — Ethereum Sepolia → Arc (real burn, real mint)", () => {
  test(
    "bridge 0.05 USDC: burn on Sepolia → attest → mint on Arc",
    async () => {
      const key = process.env.SERVER_WALLET_PRIVATE_KEY as Hex;
      expect(key, "SERVER_WALLET_PRIVATE_KEY missing").toBeTruthy();
      const account = privateKeyToAccount(key);
      expect(account.address.toLowerCase()).toBe(WALLET.toLowerCase());

      const srcRpc = process.env.SEPOLIA_RPC_URL;
      const dstRpc = process.env.ARC_RPC_URL;
      const src = CCTP_SOURCE_CHAIN; // sepolia
      const dst = "arcTestnet" as const;

      const endpoint = (
        chainKey: typeof src | typeof dst,
        rpc: string | undefined
      ) => {
        const chain = CHAINS[chainKey];
        const transport = http(rpc);
        return {
          chain: chainKey,
          usdc: USDC[chainKey].address,
          publicClient: createPublicClient({ chain, transport }),
          walletClient: createWalletClient({ account, chain, transport }),
          account,
        };
      };

      const cctp = createCctp({
        source: endpoint(src, srcRpc),
        dest: endpoint(dst, dstRpc),
      });

      const { burnTxHash, mintTxHash } = await cctp.bridge({
        amount: parseUsdc("0.05"),
        mintRecipient: WALLET, // back to ourselves — bridged USDC is recovered
      });

      // eslint-disable-next-line no-console
      console.log(
        `\n[CCTP LIVE] burn (Sepolia): ${burnTxHash}\n[CCTP LIVE] mint (Arc):     ${mintTxHash}\n`
      );
      expect(burnTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(mintTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    },
    TEN_MIN
  );
});
