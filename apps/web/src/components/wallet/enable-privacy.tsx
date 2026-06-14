"use client";

// EnablePrivacy (§23) — provisions the user's private (shielded) rail WITHOUT
// Dynamic delegation. The embedded wallet signs the canonical Unlink derivation
// message ONCE in the browser; the server stores that signature and replays it to
// derive + operate the user's REAL shielded account (payments.bootstrapPrivacy +
// delegated-signer getUserSigner). One popup, then the rail runs automatically —
// airdrops, private sends, and paid builds all settle from the shielded balance.
import type { EvmWalletAccount } from "@dynamic-labs-sdk/evm";
import { createWalletClientForWalletAccount } from "@dynamic-labs-sdk/evm/viem";
import { useWalletAccounts } from "@dynamic-labs-sdk/react-hooks";
import { CANON_UNLINK_MESSAGE } from "@superjam/onchain";
import { DEMO_MODE } from "@superjam/shared";
import { useCallback, useEffect, useState } from "react";
import { usePlatformClient } from "../use-platform-client";
import { EmojiToken, StickerButton, StickerCard } from "../ui/sticker";

export function EnablePrivacy() {
  const client = usePlatformClient();
  const { data: walletAccounts } = useWalletAccounts();
  const evmAccount = walletAccounts?.find((w) => w.chain === "EVM") as
    | EvmWalletAccount
    | undefined;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already provisioned? privateBalance resolves to a number once the shielded
  // account exists; it nulls/errors before bootstrap.
  useEffect(() => {
    let live = true;
    client.payments
      .privateBalance()
      .then((b) => live && setEnabled(b.shieldedUsdc !== null))
      .catch(() => live && setEnabled(false));
    return () => {
      live = false;
    };
  }, [client]);

  const enable = useCallback(async () => {
    if (!evmAccount) return;
    setBusy(true);
    setError(null);
    try {
      const wc = await createWalletClientForWalletAccount({
        walletAccount: evmAccount,
      });
      const address = wc.account.address;
      const signature = await wc.signMessage({
        account: address,
        message: CANON_UNLINK_MESSAGE,
      });
      await client.payments.bootstrapPrivacy({ signature, address });
      setEnabled(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("bootstrapPrivacy failed", e);
      setError("Couldn't enable — try again.");
    } finally {
      setBusy(false);
    }
  }, [client, evmAccount]);

  // Hide while loading or once enabled. DEMO: always hidden — the vault is mocked
  // (nothing to provision) and tapping Enable would hit the broken delegation flow.
  if (DEMO_MODE || enabled !== false || !evmAccount) return null;

  return (
    <StickerCard color="cream" className="p-4 flex items-center gap-3">
      <EmojiToken emoji="🔐" color="yellow" size={40} rounded="toy" />
      <div className="flex flex-col min-w-0">
        <div className="font-extrabold text-body">Enable private payments</div>
        <div className="text-small font-semibold text-muted">
          {error ?? "one tap — sign once to unlock your private vault"}
        </div>
      </div>
      <StickerButton
        color="green"
        size="sm"
        disabled={busy}
        onClick={enable}
        className="ml-auto rounded-full"
      >
        {busy ? "Enabling…" : "Enable"}
      </StickerButton>
    </StickerCard>
  );
}
