"use client";

// EnablePrivacy (§23) — provisions the user's private (shielded) rail via Dynamic
// DELEGATED ACCESS. One tap runs Dynamic's delegation flow (initDelegationProcess):
// the user consents, the SDK generates + encrypts the MPC key share and POSTs it to
// our `wallet.delegation.created` webhook, which stores it. The server then signs AS
// the user (getUserSigner delegated branch) — airdrops, private sends, and paid
// builds settle from the shielded balance with no per-op popup.
import {
  useDynamicContext,
  useWalletDelegation,
} from "@dynamic-labs/sdk-react-core";
import { useCallback, useState } from "react";
import { EmojiToken, StickerButton, StickerCard } from "../ui/sticker";

export function EnablePrivacy() {
  const { primaryWallet } = useDynamicContext();
  const { initDelegationProcess, getWalletsDelegatedStatus } =
    useWalletDelegation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myStatus = primaryWallet
    ? getWalletsDelegatedStatus().find(
        (w) => w.address.toLowerCase() === primaryWallet.address.toLowerCase()
      )
    : undefined;
  const delegated = myStatus?.status === "delegated";

  const enable = useCallback(async () => {
    if (!primaryWallet) return;
    setBusy(true);
    setError(null);
    try {
      await initDelegationProcess({ wallets: [primaryWallet] });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("delegation failed", e);
      setError("Couldn't enable — try again.");
    } finally {
      setBusy(false);
    }
  }, [primaryWallet, initDelegationProcess]);

  // Hide once delegated (or before a wallet exists).
  if (!primaryWallet || delegated) return null;

  return (
    <StickerCard color="cream" className="p-4 flex items-center gap-3">
      <EmojiToken emoji="🔐" color="yellow" size={40} rounded="toy" />
      <div className="flex flex-col min-w-0">
        <div className="font-extrabold text-body">Enable private payments</div>
        <div className="text-small font-semibold text-muted">
          {error ?? "delegate once — lets airdrops & paid builds settle privately"}
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
