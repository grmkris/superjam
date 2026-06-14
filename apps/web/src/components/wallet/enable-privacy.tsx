"use client";

// EnablePrivacy (§23) — the in-app delegation trigger. The private rail (airdrop
// shield, paid builds) needs the server to sign AS the user via Dynamic delegated
// access. Dynamic can auto-prompt on sign-in, but an already-signed-in user never
// sees it — so this gives an explicit, retryable button. delegateWaasKeyShares
// fires the `wallet.delegation.created` webhook; our server decrypts + stores the
// MPC share (and self-provisions the wallet address from the payload). The new
// headless SDK has no delegation React hook — these are client functions.
import {
  delegateWaasKeyShares,
  hasDelegatedAccess,
} from "@dynamic-labs-sdk/client/waas";
import type { EvmWalletAccount } from "@dynamic-labs-sdk/evm";
import { useWalletAccounts } from "@dynamic-labs-sdk/react-hooks";
import { useEffect, useState } from "react";
import { EmojiToken, StickerButton, StickerCard } from "../ui/sticker";

export function EnablePrivacy() {
  const { data: walletAccounts } = useWalletAccounts();
  const evmAccount = walletAccounts?.find((w) => w.chain === "EVM") as
    | EvmWalletAccount
    | undefined;
  const [delegated, setDelegated] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!evmAccount) {
      setDelegated(null);
      return;
    }
    try {
      setDelegated(hasDelegatedAccess({ walletAccount: evmAccount }));
    } catch {
      setDelegated(null);
    }
  }, [evmAccount]);

  // Hide until the wallet is ready (delegation state known).
  if (!evmAccount || delegated === null) return null;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await delegateWaasKeyShares({ walletAccount: evmAccount });
      setDelegated(hasDelegatedAccess({ walletAccount: evmAccount }));
    } catch {
      setError("Couldn't enable — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StickerCard
      color={delegated ? "white" : "cream"}
      className="p-4 flex items-center gap-3"
    >
      <EmojiToken
        emoji="🔐"
        color={delegated ? "green" : "yellow"}
        size={40}
        rounded="toy"
      />
      <div className="flex flex-col min-w-0">
        <div className="font-extrabold text-body">
          {delegated ? "Private payments on ✓" : "Enable private payments"}
        </div>
        <div className="text-small font-semibold text-muted">
          {delegated
            ? "airdrops & paid builds settle privately"
            : error ?? "one tap — lets airdrops & paid builds settle privately"}
        </div>
      </div>
      {!delegated && (
        <StickerButton
          color="green"
          size="sm"
          disabled={busy}
          onClick={enable}
          className="ml-auto rounded-full"
        >
          {busy ? "Enabling…" : "Enable"}
        </StickerButton>
      )}
    </StickerCard>
  );
}
