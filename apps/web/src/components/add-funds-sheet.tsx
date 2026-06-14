"use client";

// AddFundsSheet — the "top up" button. A SIMULATED top-up for now: it faucets test
// USDC on Arc straight into your SHIELDED (private) balance (the in-app wallet),
// instantly + server-orchestrated (no gas, no network picker). One source only; the
// public Sepolia→Arc CCTP path was dropped (test-only). Swap the faucet call for a
// real onramp later — the callers (/me, the confirm-sheet "Top up") don't change.
import { TX_CAP_USDC } from "@superjam/shared";
import { useState } from "react";
import { ToyboxSheet } from "./ui/sheet";
import { EmojiToken, StickerButton, StickerCard } from "./ui/sticker";
import { usePlatformClient } from "./use-platform-client";

const CAP = Number(TX_CAP_USDC);

export function AddFundsSheet({
  open,
  onClose,
  onFunded,
}: {
  open: boolean;
  onClose: () => void;
  onFunded?: (shieldedUsdc: string | null) => void;
}) {
  const client = usePlatformClient();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ shieldedUsdc: string | null } | null>(
    null
  );

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= CAP;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      // Arc instant faucet → shielded balance (the simulated top-up).
      const res = await client.payments.addFunds({
        sourceChain: "arcTestnet",
        amount: String(n),
      });
      setResult({ shieldedUsdc: res.shieldedUsdc });
      onFunded?.(res.shieldedUsdc);
    } catch {
      setError("Couldn't add funds — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToyboxSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setResult(null);
          setError(null);
          onClose();
        }
      }}
      title="Add funds"
    >
      <div className="flex items-center gap-2.5">
        <EmojiToken emoji="💰" color="green" size={40} />
        <div className="flex flex-col">
          <div className="text-h3 font-extrabold">Add funds</div>
          <div className="text-tiny font-semibold text-muted">
            test funds · simulated top-up · instant on Arc
          </div>
        </div>
      </div>

      {result ? (
        <StickerCard color="white" className="p-4 flex flex-col gap-1.5">
          <div className="font-extrabold text-body">
            Added ✓ — private balance {result.shieldedUsdc ?? "—"} USDC
          </div>
          <StickerButton
            color="cream"
            size="md"
            block
            onClick={onClose}
            className="mt-2"
          >
            Done
          </StickerButton>
        </StickerCard>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-baseline gap-1.5">
              <input
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                }
                inputMode="decimal"
                aria-label="Amount in USDC"
                className="w-28 text-center text-hero font-extrabold bg-transparent outline-none border-b-2 border-ink"
              />
              <span className="text-2xl font-extrabold text-muted">USDC</span>
            </div>
            {!valid && (
              <div className="text-pink text-tiny font-bold">
                enter 0–{CAP} USDC
              </div>
            )}
          </div>

          {error && (
            <div className="text-pink text-tiny font-bold text-center">{error}</div>
          )}

          <StickerButton
            color="green"
            size="lg"
            block
            disabled={!valid || busy}
            onClick={submit}
          >
            {busy ? "Adding…" : `Add ${valid ? n.toFixed(2) : "—"} USDC →`}
          </StickerButton>
        </>
      )}
    </ToyboxSheet>
  );
}
