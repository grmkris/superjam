"use client";

// PayFriendSheet (DESIGN_BRIEF §3e-iv) — pick an amount + note before the confirm
// sheet. ≤25 USDC (TX_CAP_USDC; the confirm sheet enforces it too).
import { TX_CAP_USDC } from "@superjam/shared";
import { useState } from "react";
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
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button aria-label="Dismiss" onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <div className="relative w-full max-w-[460px] bg-cream border-t-2 border-ink rounded-t-toy-lg px-5 pt-4 pb-8 flex flex-col gap-4 text-ink">
        <div className="flex items-center gap-2.5">
          <EmojiToken emoji="💸" color="green" size={40} />
          <div className="text-lg font-extrabold">Pay @{username}</div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <div className="flex items-baseline gap-1.5">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="w-28 text-center text-[40px] font-extrabold bg-transparent outline-none border-b-2 border-ink"
            />
            <span className="text-2xl font-extrabold text-muted">USDC</span>
          </div>
          {!valid && (
            <div className="text-pink text-xs font-bold">enter 0–{CAP} USDC</div>
          )}
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={80}
          placeholder="add a note…"
          className="bg-card border-2 border-ink rounded-toy px-4 py-3 text-[14px] font-semibold placeholder:text-muted outline-none focus:border-pink"
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
      </div>
    </div>
  );
}
