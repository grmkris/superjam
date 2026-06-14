"use client";

// PayFriendSheet (DESIGN_BRIEF §3e-iv) — pick an amount + note before the confirm
// sheet. ≤25 USDC (TX_CAP_USDC; the confirm sheet enforces it too). Doubles as the
// "ask for money" sheet (action="request") — same validated amount widget, just a
// different verb/emoji/colour; requesting moves no money, it sends a request line.
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
  action = "pay",
}: {
  username: string;
  onSend: (amountUsdc: number, note: string) => void;
  onClose: () => void;
  /** "pay" sends money; "request" asks the friend for it. */
  action?: "pay" | "request";
}) {
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= CAP;
  const request = action === "request";
  const title = `${request ? "Ask" : "Pay"} @${username}`;

  return (
    <ToyboxSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
    >
      <div className="flex items-center gap-2.5">
        <EmojiToken emoji={request ? "🙏" : "💸"} color={request ? "yellow" : "green"} size={40} />
        <div className="text-h3 font-extrabold">{title}</div>
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
        placeholder={request ? "what's it for?…" : "add a note…"}
      />

      <StickerButton
        color={request ? "yellow" : "green"}
        size="lg"
        block
        disabled={!valid}
        onClick={() => onSend(n, note.trim())}
      >
        {request ? "Ask for" : "Send"} {valid ? n.toFixed(2) : "—"} USDC →
      </StickerButton>
    </ToyboxSheet>
  );
}
