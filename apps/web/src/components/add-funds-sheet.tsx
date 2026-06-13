"use client";

// AddFundsSheet — the unified "add funds" rail. Pick a source: Arc (instant) or
// Ethereum Sepolia (cross-chain via CCTP Fast Transfer). Either way the money lands
// in your SHIELDED (private) balance — the in-app wallet. Server-orchestrated: no
// gas, no network picker. v1 is a faucet button; later it's reskinned as a top-up.
import { TX_CAP_USDC } from "@superjam/shared";
import { useState } from "react";
import { ToyboxSheet } from "./ui/sheet";
import { EmojiToken, StickerButton, StickerCard } from "./ui/sticker";
import { usePlatformClient } from "./use-platform-client";

const CAP = Number(TX_CAP_USDC);
type Source = "arcTestnet" | "sepolia";

interface AddFundsResult {
  shieldedUsdc: string | null;
  burnTxHash: string | null;
  mintTxHash: string | null;
}

function SourceChip({
  active,
  onClick,
  emoji,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`focus-ring flex-1 rounded-toy border-2 p-3 text-left transition ${
        active ? "border-ink bg-cream shadow-sticker-sm" : "border-line bg-white"
      }`}
    >
      <div className="text-xl">{emoji}</div>
      <div className="font-extrabold text-body">{label}</div>
      <div className="text-tiny font-semibold text-muted">{sub}</div>
    </button>
  );
}

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
  const [source, setSource] = useState<Source>("arcTestnet");
  const [amount, setAmount] = useState("2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddFundsResult | null>(null);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= CAP;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.payments.addFunds({
        sourceChain: source,
        amount: String(n),
      });
      setResult(res);
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
        <div className="text-h3 font-extrabold">Add funds</div>
      </div>

      {result ? (
        <StickerCard color="white" className="p-4 flex flex-col gap-1.5">
          <div className="font-extrabold text-body">
            Added ✓ — private balance {result.shieldedUsdc ?? "—"} USDC
          </div>
          {result.burnTxHash && (
            <div className="text-tiny font-mono text-muted break-all">
              burn (Sepolia): {result.burnTxHash}
            </div>
          )}
          {result.mintTxHash && (
            <div className="text-tiny font-mono text-muted break-all">
              mint (Arc): {result.mintTxHash}
            </div>
          )}
          <StickerButton color="cream" size="md" block onClick={onClose} className="mt-2">
            Done
          </StickerButton>
        </StickerCard>
      ) : (
        <>
          {/* where the money comes from — both land in your private balance */}
          <div className="flex gap-2">
            <SourceChip
              active={source === "arcTestnet"}
              onClick={() => setSource("arcTestnet")}
              emoji="⚡"
              label="Arc"
              sub="instant"
            />
            <SourceChip
              active={source === "sepolia"}
              onClick={() => setSource("sepolia")}
              emoji="🌉"
              label="Sepolia"
              sub="cross-chain · CCTP"
            />
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="flex items-baseline gap-1.5">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                aria-label="Amount in USDC"
                className="w-28 text-center text-hero font-extrabold bg-transparent outline-none border-b-2 border-ink"
              />
              <span className="text-2xl font-extrabold text-muted">USDC</span>
            </div>
            {!valid && (
              <div className="text-pink text-tiny font-bold">enter 0–{CAP} USDC</div>
            )}
          </div>

          {error && <div className="text-pink text-tiny font-bold text-center">{error}</div>}

          <StickerButton
            color="green"
            size="lg"
            block
            disabled={!valid || busy}
            onClick={submit}
          >
            {busy
              ? source === "sepolia"
                ? "Claiming → bridging → shielding…"
                : "Adding…"
              : `Add ${valid ? n.toFixed(2) : "—"} USDC →`}
          </StickerButton>

          {source === "sepolia" && (
            <div className="text-tiny font-semibold text-muted text-center">
              claim on Ethereum Sepolia → CCTP-bridge to Arc → swap into your private
              balance — one tap, ~1 min
            </div>
          )}
        </>
      )}
    </ToyboxSheet>
  );
}
