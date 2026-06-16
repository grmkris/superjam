"use client";

// useRelayExecutor — the REAL confirm-sheet executor (DESIGN_BRIEF §3d). Turns an
// approved ConfirmIntent into money over the ONE public rail (§15): tip /
// payFriend / publish / pot stake all resolve the recipient → build the EIP-3009
// transfer authorization → sign it with the Dynamic embedded wallet (in the
// browser; the key never leaves the user) → relay gaslessly via payments.relay.
// A friend send also records a chat money-line (payments.recordTip). Builds are
// free — there's no buildFee leg.
// Injected into <ConfirmProvider> by client-root's WiredConfirm (which sits inside
// <Providers> so the wallet is reachable).
//
// New headless SDK: the EVM wallet account comes from useWalletAccounts(); a viem
// WalletClient is built with createWalletClientForWalletAccount().
import type { EvmWalletAccount } from "@dynamic-labs-sdk/evm";
import { createWalletClientForWalletAccount } from "@dynamic-labs-sdk/evm/viem";
import { useWalletAccounts } from "@dynamic-labs-sdk/react-hooks";
import type { AppId } from "@superjam/shared";
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
  const { data: walletAccounts } = useWalletAccounts();
  const evmAccount = walletAccounts?.find((w) => w.chain === "EVM") as
    | EvmWalletAccount
    | undefined;

  return useCallback<PayExecutor>(
    async (intent) => {
      if (!intent.to) {
        throw new Error("Missing recipient");
      }

      // Every money move rides the public EIP-3009 gasless relay: resolve the
      // recipient → sign in the browser → relay → real tx hash.
      if (!evmAccount) {
        throw new Error("Connect your wallet to pay");
      }

      // 1) recipient string → on-chain address (server-side lookup)
      const { address: to } = await client.payments.resolveRecipient({
        to: intent.to,
        appId: intent.appId as AppId | undefined,
      });

      // 2) build the EIP-3009 transfer authorization
      const walletClient = await createWalletClientForWalletAccount({
        walletAccount: evmAccount,
      });
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

      // A friend send (@username) records a chat money-line server-side. The money
      // has already moved; the line is best-effort.
      if (intent.kind === "payFriend" && intent.to.startsWith("@")) {
        await client.payments
          .recordTip({
            toUsername: intent.to.slice(1),
            amountUsdc: String(intent.amountUsdc),
            txHash,
          })
          .catch(() => {});
      }
      return { txHash };
    },
    [client, evmAccount]
  );
}
