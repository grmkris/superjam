"use client";

// PayFriendSheet (DESIGN_BRIEF §3e-iv) — pick an amount + note before the confirm
// sheet. ≤25 USDC (TX_CAP_USDC; the confirm sheet enforces it too).
import { TX_CAP_USDC } from "@superjam/shared";
import { useState } from "react";
import { Input } from "../ui/field";
import { ToyboxSheet } from "../ui/sheet";
import { EmojiToken, StickerButton } from "../ui/sticker";

const CAP = Number(TX_CAP_USDC);

export function PayFriendSheet({
  username,
  onSend,
  onClose,
}: {
  username: string;
  onSend: (amountUsdc: number, note: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= CAP;

  return (
    <ToyboxSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Pay @${username}`}
    >
      <div className="flex items-center gap-2.5">
        <EmojiToken emoji="💸" color="green" size={40} />
        <div className="text-h3 font-extrabold">Pay @{username}</div>
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

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={80}
        placeholder="add a note…"
      />

      <StickerButton
        color="green"
        size="lg"
        block
        disabled={!valid}
        onClick={() => onSend(n, note.trim())}
      >
        Send {valid ? n.toFixed(2) : "—"} USDC →
      </StickerButton>
    </ToyboxSheet>
  );
}
