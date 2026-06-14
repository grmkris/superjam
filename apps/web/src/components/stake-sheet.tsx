"use client";

// StakeSheet — owner-only "manage stake" for a builder. Two rails into the SAME
// StakeSlash escrow: an instant same-chain top-up (sponsored `depositFor` on Arc)
// and a cross-chain top-up via CCTP (burn on Sepolia → CctpEscrowHook credits the
// stake on Arc, ~1 min — the Circle #2 flagship, made clickable). Both bump the
// builder's on-chain stake; the caller refreshes the live read after.
import type { BuilderAgentId } from "@superjam/shared";
import { TX_CAP_USDC } from "@superjam/shared";
import { useState } from "react";
import { ToyboxSheet } from "./ui/sheet";
import { EmojiToken, StickerButton, StickerCard } from "./ui/sticker";
import { usePlatformClient } from "./use-platform-client";

const CAP = Number(TX_CAP_USDC);

export function StakeSheet({
  open,
  onClose,
  agentId,
  agentName,
  onStaked,
}: {
  open: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  onStaked?: (stakedUsdc: string | null) => void;
}) {
  const client = usePlatformClient();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState<null | "same" | "cctp">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= CAP;

  const topUp = async (kind: "same" | "cctp") => {
    if (!valid) return;
    setBusy(kind);
    setError(null);
    try {
      const res =
        kind === "same"
          ? await client.agents.topUpStake({
              agentId: agentId as BuilderAgentId,
              amount: String(n),
            })
          : await client.agents.topUpStakeCrossChain({
              agentId: agentId as BuilderAgentId,
              amount: String(n),
            });
      setDone(res.stakedUsdc);
      onStaked?.(res.stakedUsdc);
    } catch {
      setError(
        kind === "cctp"
          ? "Cross-chain top-up failed — try again."
          : "Stake top-up failed — try again."
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <ToyboxSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDone(null);
          setError(null);
          onClose();
        }
      }}
      title="Manage stake"
    >
      <div className="flex items-center gap-2.5">
        <EmojiToken emoji="🌱" color="green" size={40} />
        <div className="flex flex-col">
          <div className="text-h3 font-extrabold">Stake on {agentName}</div>
          <div className="text-tiny font-semibold text-muted">
            earns yield · slashable on bad work
          </div>
        </div>
      </div>

      {done ? (
        <StickerCard color="white" className="p-4 flex flex-col gap-1.5">
          <div className="font-extrabold text-body">
            Staked ✓ — now {done ?? "—"} USDC
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
            disabled={!valid || busy !== null}
            onClick={() => topUp("same")}
          >
            {busy === "same"
              ? "Staking…"
              : `Add ${valid ? n.toFixed(2) : "—"} USDC stake →`}
          </StickerButton>

          <StickerButton
            color="white"
            size="md"
            block
            disabled={!valid || busy !== null}
            onClick={() => topUp("cctp")}
          >
            {busy === "cctp"
              ? "Bridging from Sepolia…"
              : "Add from another chain (CCTP) 🌉"}
          </StickerButton>

          <div className="text-tiny font-semibold text-muted text-center">
            test funds · sponsored top-up · instant on Arc, ~1 min via CCTP
          </div>
        </>
      )}
    </ToyboxSheet>
  );
}
