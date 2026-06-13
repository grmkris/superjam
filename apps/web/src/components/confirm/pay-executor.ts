"use client";

// useRelayExecutor — the REAL confirm-sheet executor (DESIGN_BRIEF §3d). Turns
// an approved ConfirmIntent into money: resolve recipient → build the EIP-3009
// transfer authorization → sign it with the Dynamic embedded wallet (in the
// browser; the key never leaves the user) → relay it gaslessly via C's
// payments.relay → return the real tx hash. Injected into <ConfirmProvider> by
// client-root's WiredConfirm (which sits inside <Providers> so the wallet is
// reachable).
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
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
  const { primaryWallet } = useDynamicContext();

  return useCallback<PayExecutor>(
    async (intent) => {
      if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
        throw new Error("Connect your wallet to pay");
      }

      // 1) recipient string → on-chain address (server-side lookup)
      const { address: to } = await client.payments.resolveRecipient({
        to: intent.to,
        appId: intent.appId as AppId | undefined,
      });

      // 2) build the EIP-3009 transfer authorization
      const walletClient = await primaryWallet.getWalletClient();
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
    [client, primaryWallet]
  );
}
