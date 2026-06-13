"use client";

// ConfirmSheet (DESIGN_BRIEF §3d) — the money moment. A host-rendered bottom
// sheet OVER the iframe; stays Toybox (warm, not a cold bank). Trust is marked
// by the "🔒 superjam confirm" chip + "asked for by <jam> — jams never touch
// your wallet", not by a change of visual language. Four states.
import { NameTag } from "../name-tag";
import { basescan } from "../ui/brand";
import { cx } from "../ui/cx";
import { ToyboxSheet } from "../ui/sheet";
import { EmojiToken, StickerButton } from "../ui/sticker";
import type { ConfirmIntent } from "./confirm-controller";

export type ConfirmPhase = "review" | "pending" | "success" | "error";

const shortAddr = (a: string): string =>
  a.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

function summary(intent: ConfirmIntent): string {
  const amt = `${intent.amountUsdc.toFixed(2)} USDC`;
  switch (intent.kind) {
    case "publish":
      return `Publish your jam for ${amt}`;
    case "stake":
      return `Stake ${amt}`;
    case "payFriend":
      return `Send ${amt} to a friend`;
    default:
      return `Send ${amt}`;
  }
}

export function ConfirmSheet({
  intent,
  phase,
  txHash,
  error,
  onApprove,
  onReject,
}: {
  intent: ConfirmIntent;
  phase: ConfirmPhase;
  txHash?: string;
  error?: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <ToyboxSheet
      open
      // backdrop / drag / Esc reject only while reviewing; locked mid-flight
      dismissible={phase === "review"}
      onOpenChange={(next) => {
        if (!next) onReject();
      }}
      title="Confirm payment"
    >
      {/* header: trust chip + jam attribution */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 bg-ink text-cream rounded-full px-3 py-1 text-tiny font-extrabold">
          🔒 superjam confirm
        </span>
        {intent.jam && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-small font-bold text-muted">
            <span>{intent.jam.iconEmoji}</span>
            {intent.jam.name}
          </span>
        )}
      </div>

      {phase === "review" && (
        <ReviewBody intent={intent} onApprove={onApprove} onReject={onReject} />
      )}
      {phase === "pending" && <PendingBody txHash={txHash} />}
      {phase === "success" && <SuccessBody intent={intent} />}
      {phase === "error" && <ErrorBody error={error} onClose={onReject} />}

      {intent.jam && phase === "review" && (
        <div className="text-center text-small font-medium text-muted leading-snug">
          asked for by {intent.jam.name} — jams never touch your wallet.
        </div>
      )}
    </ToyboxSheet>
  );
}

function ReviewBody({
  intent,
  onApprove,
  onReject,
}: {
  intent: ConfirmIntent;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <>
      <div className="flex flex-col items-center gap-1.5">
        <div className="text-body font-bold text-muted">{summary(intent)}</div>
        <div className="text-hero font-extrabold">
          {intent.amountUsdc.toFixed(2)}{" "}
          <span className="text-2xl text-muted">USDC</span>
        </div>
        <div className="mt-1">
          {intent.toName ? (
            <NameTag name={intent.toName} />
          ) : (
            <span className="font-mono text-small font-bold bg-card border-2 border-ink rounded-full px-3 py-1">
              {shortAddr(intent.to)}
            </span>
          )}
        </div>
        {intent.memo && (
          <div className="text-small font-semibold text-ink text-center mt-1">
            “{intent.memo}”
          </div>
        )}
      </div>
      <div className="flex gap-3">
        <StickerButton color="white" size="lg" block onClick={onReject}>
          Reject
        </StickerButton>
        <StickerButton color="green" size="lg" block onClick={onApprove}>
          Approve
        </StickerButton>
      </div>
    </>
  );
}

function PendingBody({ txHash }: { txHash?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-3">
      <Spinner />
      <div className="font-extrabold text-h3">sending…</div>
      {txHash && <TxChip txHash={txHash} />}
    </div>
  );
}

function SuccessBody({ intent }: { intent: ConfirmIntent }) {
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <EmojiToken emoji="✓" color="green" size={64} />
      <div className="font-extrabold text-h3">sent! 🎉</div>
      <div className="text-body font-semibold text-muted">
        {intent.amountUsdc.toFixed(2)} USDC on its way
      </div>
    </div>
  );
}

function ErrorBody({ error, onClose }: { error?: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <EmojiToken emoji="😖" color="pink" size={56} />
      <div className="font-extrabold text-h3">that didn't go through</div>
      <div className="text-small font-semibold text-muted text-center px-2">
        {error ?? "Something went wrong. Nothing was sent."}
      </div>
      <StickerButton color="white" size="md" block onClick={onClose}>
        Close
      </StickerButton>
    </div>
  );
}

function TxChip({ txHash }: { txHash: string }) {
  return (
    <a
      href={basescan(txHash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 bg-card border-2 border-ink rounded-full px-3 py-1 font-mono text-small font-bold no-underline text-ink"
    >
      {txHash.slice(0, 8)}…{txHash.slice(-6)}{" "}
      <span className="text-blue">↗</span>
    </a>
  );
}

function Spinner() {
  return (
    <span
      className={cx(
        "inline-block w-9 h-9 rounded-full border-[3px] border-ink border-t-transparent",
        "animate-spin"
      )}
    />
  );
}
