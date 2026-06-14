"use client";

// ShieldAction — the showcase punchline: one tap moves PUBLIC Arc USDC into your
// SHIELDED balance (payments.depositPrivate, server-delegated — no popup, no gas
// dance). Fires onShieldStart so the page can fly coins into the vault, then
// onShielded to refetch both rails.
import { TX_CAP_USDC } from "@superjam/shared";
import { useState } from "react";
import { StickerButton, StickerCard } from "../ui/sticker";
import { usePlatformClient } from "../use-platform-client";

const CAP = Number(TX_CAP_USDC);

export function ShieldAction({
  publicUsdc,
  onShieldStart,
  onShielded,
}: {
  /** the user's current public balance (decimal string) — caps the shield amount. */
  publicUsdc: string | null;
  onShieldStart: () => void;
  onShielded: () => void;
}) {
  const client = usePlatformClient();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const pub = publicUsdc === null ? 0 : Number(publicUsdc);
  const n = amount === "" ? pub : Number(amount); // blank = shield it all
  const valid = Number.isFinite(n) && n > 0 && n <= Math.min(pub, CAP);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setTxHash(null);
    onShieldStart();
    try {
      const res = await client.payments.depositPrivate({ amount: String(n) });
      setTxHash(res.txHash);
      setAmount("");
      onShielded();
    } catch {
      setError("Couldn't shield — make sure you have public USDC.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StickerCard color="white" className="p-4 flex flex-col gap-3">
      <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
        2 · shield it → private 🔒
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-baseline gap-1.5 flex-1">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder={pub > 0 ? pub.toFixed(2) : "0.00"}
            aria-label="Amount to shield in USDC"
            className="w-24 text-center text-h2 font-extrabold bg-transparent outline-none border-b-2 border-ink placeholder:text-muted/50"
          />
          <span className="text-body font-extrabold text-muted">USDC</span>
        </div>
        <StickerButton color="green" size="md" disabled={!valid || busy} onClick={submit}>
          {busy ? "Shielding…" : "Shield →"}
        </StickerButton>
      </div>
      <div className="text-tiny font-semibold text-muted">
        leave blank to shield your whole public balance
      </div>
      {error && <div className="text-pink text-tiny font-bold">{error}</div>}
      {txHash && (
        <div className="text-tiny font-mono text-muted break-all">
          shielded ✓ tx {txHash}
        </div>
      )}
    </StickerCard>
  );
}
