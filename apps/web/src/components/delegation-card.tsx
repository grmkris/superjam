"use client";

// "Let SuperJam act for you" — Dynamic Delegated Access opt-in (§23). Enabling it
// grants the SuperJam server limited signing rights to the user's embedded wallet,
// so payments + agent (MCP) actions can run without a per-tap signature. The
// approval prompt is Dynamic's; on approval their webhook hands our server the
// encrypted key share. Revocable any time — revoke removes the server's access.
import {
  delegateWaasKeyShares,
  hasDelegatedAccess,
  revokeWaasDelegation,
} from "@dynamic-labs-sdk/client/waas";
import type { EvmWalletAccount } from "@dynamic-labs-sdk/evm";
import { useWalletAccounts } from "@dynamic-labs-sdk/react-hooks";
import { useEffect, useState } from "react";
import { EmojiToken, StickerButton, StickerCard } from "./ui/sticker";

// hasDelegatedAccess reads client state synchronously; module-scoped so it's a
// stable reference (not an effect dependency).
const readDelegated = (account: EvmWalletAccount): boolean => {
  try {
    return hasDelegatedAccess({ walletAccount: account });
  } catch {
    return false;
  }
};

export function DelegationCard() {
  const { data: walletAccounts } = useWalletAccounts();
  const walletAccount = walletAccounts?.find((w) => w.chain === "EVM") as
    | EvmWalletAccount
    | undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirror the synchronous status into state so the card reflects it on wallet
  // load + after a toggle.
  const [delegated, setDelegated] = useState(false);

  useEffect(() => {
    setDelegated(walletAccount ? readDelegated(walletAccount) : false);
  }, [walletAccount]);

  if (!walletAccount) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (delegated) {
        await revokeWaasDelegation({ walletAccount });
      } else {
        await delegateWaasKeyShares({ walletAccount });
      }
      setDelegated(readDelegated(walletAccount));
    } catch {
      setError(
        delegated
          ? "Couldn't turn this off — try again."
          : "Couldn't enable it — approve the prompt and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <StickerCard color="cream" className="p-3.5 flex items-center gap-3">
      <EmojiToken emoji="🤝" color="blue" size={40} rounded="toy" />
      <div className="flex flex-col min-w-0">
        <div className="font-extrabold text-body">Let SuperJam act for you</div>
        <div className="text-small font-semibold text-muted">
          {delegated
            ? "on — payments & agents run without a tap"
            : "off — you approve each payment yourself"}
        </div>
        {error ? (
          <div className="text-small font-semibold text-pink">{error}</div>
        ) : null}
      </div>
      <StickerButton
        color={delegated ? "cream" : "blue"}
        size="md"
        disabled={busy}
        onClick={() => void toggle()}
        className="ml-auto shrink-0"
      >
        {busy ? "…" : delegated ? "Turn off" : "Enable"}
      </StickerButton>
    </StickerCard>
  );
}
