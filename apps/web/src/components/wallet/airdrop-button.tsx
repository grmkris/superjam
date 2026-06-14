"use client";

// AirdropButton — drops PUBLIC Arc USDC into your own wallet (testnet faucet via
// payments.faucetPublic). The first half of the showcase: get money in the open,
// then shield it. Mirrors add-funds-sheet's amount input + result card.
import { TX_CAP_USDC } from "@superjam/shared";
import { useState } from "react";
import { StickerButton, StickerCard } from "../ui/sticker";
import { usePlatformClient } from "../use-platform-client";

const CAP = Number(TX_CAP_USDC);

export function AirdropButton({ onAirdropped }: { onAirdropped: () => void }) {
  const client = usePlatformClient();
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= CAP;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.payments.faucetPublic({ amount: String(n) });
      setTxHash(res.txHash);
      onAirdropped();
    } catch {
      setError("Airdrop failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StickerCard color="cream" className="p-4 flex flex-col gap-3">
      <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
        1 · airdrop public USDC
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-baseline gap-1.5 flex-1">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            aria-label="Airdrop amount in USDC"
            className="w-24 text-center text-h2 font-extrabold bg-transparent outline-none border-b-2 border-ink"
          />
          <span className="text-body font-extrabold text-muted">USDC</span>
        </div>
        <StickerButton color="yellow" size="md" disabled={!valid || busy} onClick={submit}>
          {busy ? "Dropping…" : "Airdrop ↓"}
        </StickerButton>
      </div>
      {!valid && <div className="text-pink text-tiny font-bold">enter 0–{CAP} USDC</div>}
      {error && <div className="text-pink text-tiny font-bold">{error}</div>}
      {txHash && (
        <div className="text-tiny font-mono text-muted break-all">
          sent ✓ tx {txHash}
        </div>
      )}
    </StickerCard>
  );
}
