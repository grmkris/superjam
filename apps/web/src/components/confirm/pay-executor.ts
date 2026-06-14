"use client";

// useRelayExecutor — the REAL confirm-sheet executor (DESIGN_BRIEF §3d). Turns an
// approved ConfirmIntent into money over the right rail (§15):
//   • tip / payFriend → the SHIELDED Unlink rail (payments.privateSend), private
//     by default, server-signed (no browser signature).
//   • buildFee → the x402 private rail (builds.payBuildFee), settled server-side.
//   • publish / stake → the PUBLIC EIP-3009 gasless relay: resolve recipient →
//     build the transfer authorization → sign it with the Dynamic embedded wallet
//     (in the browser; the key never leaves the user) → relay via payments.relay.
//     These are the payments the platform must verify by reading an on-chain
//     receipt, so they stay public.
// Injected into <ConfirmProvider> by client-root's WiredConfirm (which sits inside
// <Providers> so the wallet is reachable).
//
// Dynamic React SDK: the EVM wallet is the primaryWallet from useDynamicContext();
// a viem WalletClient comes from wallet.getWalletClient().
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import type { AppId, BuilderAgentId } from "@superjam/shared";
import {
  PUBLIC_CHAIN,
  USDC,
  authWindow,
  buildTransferAuth,
  parseUsdc,
  randomTransferNonce,
} from "@superjam/onchain";
import { useCallback } from "react";
import type { PayExecutor } from "./confirm-provider";
import { usePlatformClient } from "../use-platform-client";

export function useRelayExecutor(): PayExecutor {
  const client = usePlatformClient();
  const { primaryWallet } = useDynamicContext();
  const evmWallet =
    primaryWallet && isEthereumWallet(primaryWallet) ? primaryWallet : undefined;

  return useCallback<PayExecutor>(
    async (intent) => {
      // Build fee → the x402 PRIVATE rail (§14). Settled server-side from the
      // shielded balance (or free for a verified human hiring a human-backed
      // builder) — no browser signing, no public wallet. Returns null when free.
      if (intent.kind === "buildFee") {
        if (!intent.builderId) {
          throw new Error("Missing builder for the build fee");
        }
        const { txHash, paymentToken } = await client.builds.payBuildFee({
          builderId: intent.builderId as BuilderAgentId,
        });
        return { txHash, paymentToken };
      }

      if (!intent.to) {
        throw new Error("Missing recipient");
      }

      // Tips + in-jam payUSDC → the SHIELDED Unlink rail (§15, private by default).
      // Server-side via the delegated signer — no browser signature, no public
      // wallet, no on-chain Transfer log. A friend send also records the chat line.
      if (intent.kind === "tip" || intent.kind === "payFriend") {
        const { txHash } = await client.payments.privateSend({
          to: intent.to,
          amount: String(intent.amountUsdc),
          appId: intent.appId as AppId | undefined,
        });
        return { txHash };
      }

      // Public rail (publish fee / pot stake) — the platform must verify these by
      // reading the on-chain receipt, so they stay on the EIP-3009 gasless relay.
      if (!evmWallet) {
        throw new Error("Connect your wallet to pay");
      }

      // 1) recipient string → on-chain address (server-side lookup)
      const { address: to } = await client.payments.resolveRecipient({
        to: intent.to,
        appId: intent.appId as AppId | undefined,
      });

      // 2) build the EIP-3009 transfer authorization
      const walletClient = await evmWallet.getWalletClient();
      const from = walletClient.account.address;
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const { validAfter, validBefore } = authWindow(nowSec);
      const typed = buildTransferAuth({
        usdc: USDC[PUBLIC_CHAIN],
        from,
        to,
        value: parseUsdc(String(intent.amountUsdc)),
        validAfter,
        validBefore,
        nonce: randomTransferNonce(),
      });

      // 3) sign in the browser
      const signature = await walletClient.signTypedData({
        account: from,
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      });

      // 4) relay gaslessly → real tx hash
      const { txHash } = await client.payments.relay({
        chain: PUBLIC_CHAIN,
        authorization: {
          from: typed.message.from,
          to: typed.message.to,
          value: typed.message.value.toString(),
          validAfter: typed.message.validAfter.toString(),
          validBefore: typed.message.validBefore.toString(),
          nonce: typed.message.nonce,
        },
        signature,
      });
      return { txHash };
    },
    [client, evmWallet]
  );
}
