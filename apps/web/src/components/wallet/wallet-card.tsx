"use client";

// WalletCard — the profile's wallet. Shows the single public USDC balance from
// payments.balance().publicUsdc ("—" when null). "Get testnet USDC" drops test
// USDC into the wallet (faucetPublic). Toybox sticker language.
import { useCallback, useEffect, useState } from "react";
import { StickerButton, StickerCard } from "../ui/sticker";
import { Skeleton } from "../ui/skeleton";
import { usePlatformClient } from "../use-platform-client";
import { AIRDROP_USDC, useTopUp } from "./use-top-up";

type Bal = string | null | "loading";

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function WalletCard({ walletAddress }: { walletAddress: string | null }) {
  const client = usePlatformClient();
  const { topUp, busy, error } = useTopUp();
  const [bal, setBal] = useState<Bal>("loading");

  const refetch = useCallback(() => {
    client.payments
      .balance()
      .then((b) => setBal(b.publicUsdc))
      .catch(() => setBal(null));
  }, [client]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const drop = async () => {
    if (await topUp()) refetch();
  };

  const shown = bal === "loading" || bal === null ? null : Number(bal).toFixed(2);

  return (
    <StickerCard
      color="white"
      className="relative overflow-hidden p-5 flex flex-col gap-1 shadow-sticker-md"
    >
      <div className="flex items-center gap-1.5 text-tiny font-extrabold uppercase tracking-wide text-muted">
        your balance
      </div>

      {bal === "loading" ? (
        <Skeleton className="mt-1 h-11 w-44" />
      ) : (
        <div className="text-hero font-extrabold leading-none tracking-display tabular-nums">
          {shown ?? "—"} <span className="text-2xl font-bold text-muted">USDC</span>
        </div>
      )}

      <div className="text-small font-semibold text-muted">
        public USDC on Arc testnet
      </div>

      <div className="mt-2 flex items-center gap-2">
        <StickerButton
          color="green"
          size="sm"
          disabled={busy}
          onClick={drop}
          className="rounded-full"
        >
          {busy ? "Getting…" : `Get $${AIRDROP_USDC} testnet USDC ↓`}
        </StickerButton>
        {walletAddress && (
          <button
            onClick={() => navigator.clipboard?.writeText(walletAddress).catch(() => {})}
            className="focus-ring ml-auto font-mono text-small font-semibold text-muted"
          >
            {short(walletAddress)} 📋
          </button>
        )}
      </div>

      {error && <div className="text-pink text-tiny font-bold mt-1">{error}</div>}
    </StickerCard>
  );
}
