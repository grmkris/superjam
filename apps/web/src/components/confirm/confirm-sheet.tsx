"use client";

// ConfirmSheet (DESIGN_BRIEF §3d) — the money moment. A host-rendered bottom
// sheet OVER the iframe; stays Toybox (warm, not a cold bank). Trust is marked
// by the "🔒 superjam confirm" chip + "asked for by <jam> — jams never touch
// your wallet", not by a change of visual language. Four states.
import type { BuilderAgentId } from "@superjam/shared";
import { useCallback, useEffect, useState } from "react";
import { AddFundsSheet } from "../add-funds-sheet";
import { HumanBackedBadge } from "../builder-bits";
import { NameTag } from "../name-tag";
import { basescan } from "../ui/brand";
import { cx } from "../ui/cx";
import { ToyboxSheet } from "../ui/sheet";
import { EmojiToken, StickerButton } from "../ui/sticker";
import { usePlatformClient } from "../use-platform-client";
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
    case "buildFee":
      return "Build fee";
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
  txHash?: string | null;
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

      {phase === "review" && intent.kind === "buildFee" && (
        <BuildFeeReview intent={intent} onApprove={onApprove} onReject={onReject} />
      )}
      {phase === "review" && intent.kind !== "buildFee" && (
        <ReviewBody intent={intent} onApprove={onApprove} onReject={onReject} />
      )}
      {phase === "pending" && <PendingBody txHash={txHash} />}
      {phase === "success" && <SuccessBody intent={intent} txHash={txHash} />}
      {phase === "error" && <ErrorBody error={error} onClose={onReject} />}

      {intent.jam && phase === "review" && intent.kind !== "buildFee" && (
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
              {shortAddr(intent.to ?? "")}
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

interface BuildFeeQuote {
  builder: {
    id: string;
    name: string;
    slug: string;
    ensName: string | null;
    endpointUrl: string;
    displayName: string;
  };
  priceUsdc: string;
  free: {
    eligible: boolean;
    usesLeft: number | null;
    usesTotal: number | null;
    reason: "worldid" | null;
  };
  balance: { shieldedUsdc: string | null; sufficient: boolean };
}

// The build-fee review (DESIGN_BRIEF §3d, §14): quotes the chosen builder, then
// shows one of — FREE (a verified human hiring a human-backed builder), PAID
// (settles over the x402 private rail), or PAID-but-SHORT (offers a top-up first).
function BuildFeeReview({
  intent,
  onApprove,
  onReject,
}: {
  intent: ConfirmIntent;
  onApprove: () => void;
  onReject: () => void;
}) {
  const client = usePlatformClient();
  const [quote, setQuote] = useState<BuildFeeQuote | null>(null);
  const [failed, setFailed] = useState(false);
  const [topup, setTopup] = useState(false);

  const loadQuote = useCallback(() => {
    if (!intent.builderId) {
      setFailed(true);
      return;
    }
    setFailed(false);
    client.builds
      .quoteBuilder({ builderId: intent.builderId as BuilderAgentId })
      .then((q) => setQuote(q as BuildFeeQuote))
      .catch(() => setFailed(true));
  }, [client, intent.builderId]);

  useEffect(() => {
    loadQuote();
  }, [loadQuote]);

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 py-2">
        <EmojiToken emoji="😖" color="pink" size={48} />
        <div className="text-small font-semibold text-muted text-center">
          couldn't load the build fee — try again.
        </div>
        <StickerButton color="white" size="md" block onClick={onReject}>
          Close
        </StickerButton>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="flex flex-col items-center gap-3 py-5">
        <div className="h-12 w-40 bg-card border-2 border-ink rounded-toy animate-pulse" />
        <div className="h-7 w-28 bg-card border-2 border-ink rounded-full animate-pulse" />
      </div>
    );
  }

  const price = Number(quote.priceUsdc);

  // FREE — a verified human hiring a human-backed (AgentBook) builder.
  if (quote.free.eligible) {
    return (
      <>
        <div className="flex flex-col items-center gap-2">
          <div className="text-body font-bold text-muted">Build fee</div>
          <div className="text-hero font-extrabold text-green-ink">Free</div>
          <HumanBackedBadge size="md" />
          <div className="text-small font-semibold text-muted text-center px-2 mt-1">
            you're a verified human &amp; {quote.builder.name} is human-backed — this
            build's on the house.
          </div>
        </div>
        <div className="flex gap-3">
          <StickerButton color="white" size="lg" block onClick={onReject}>
            Not now
          </StickerButton>
          <StickerButton color="green" size="lg" block onClick={onApprove}>
            Use free build
          </StickerButton>
        </div>
      </>
    );
  }

  // PAID but the shielded balance is short — top up first, then re-quote.
  if (!quote.balance.sufficient) {
    return (
      <>
        <div className="flex flex-col items-center gap-1.5">
          <div className="text-body font-bold text-muted">Build fee</div>
          <div className="text-hero font-extrabold">
            {price.toFixed(2)} <span className="text-2xl text-muted">USDC</span>
          </div>
          <NameTag name={quote.builder.displayName} />
          <div className="text-small font-semibold text-pink text-center mt-1">
            not enough in your balance ({quote.balance.shieldedUsdc ?? "0"} USDC) — top
            up to build.
          </div>
        </div>
        <div className="flex gap-3">
          <StickerButton color="white" size="lg" block onClick={onReject}>
            Reject
          </StickerButton>
          <StickerButton color="green" size="lg" block onClick={() => setTopup(true)}>
            Top up
          </StickerButton>
        </div>
        <AddFundsSheet
          open={topup}
          onClose={() => setTopup(false)}
          onFunded={() => {
            setTopup(false);
            setQuote(null);
            loadQuote();
          }}
        />
      </>
    );
  }

  // PAID, balance covers it — settles over the x402 private rail on Approve.
  return (
    <>
      <div className="flex flex-col items-center gap-1.5">
        <div className="text-body font-bold text-muted">Build fee</div>
        <div className="text-hero font-extrabold">
          {price.toFixed(2)} <span className="text-2xl text-muted">USDC</span>
        </div>
        <NameTag name={quote.builder.displayName} />
        <div className="text-small font-semibold text-ink text-center mt-1">
          “build fee — no refunds”
        </div>
        <div className="text-tiny font-semibold text-muted">
          from your private balance · {quote.balance.shieldedUsdc ?? "—"} USDC
        </div>
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

function PendingBody({ txHash }: { txHash?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 py-3">
      <Spinner />
      <div className="font-extrabold text-h3">sending…</div>
      {txHash && <TxChip txHash={txHash} />}
    </div>
  );
}

function SuccessBody({
  intent,
  txHash,
}: {
  intent: ConfirmIntent;
  txHash?: string | null;
}) {
  // A build fee with no hash is the World free build — no money moved.
  const freeBuild = intent.kind === "buildFee" && !txHash;
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <EmojiToken emoji="✓" color="green" size={64} />
      <div className="font-extrabold text-h3">
        {freeBuild ? "Free build unlocked! 🎉" : "sent! 🎉"}
      </div>
      <div className="text-body font-semibold text-muted">
        {freeBuild
          ? "your jam's on the house"
          : `${intent.amountUsdc.toFixed(2)} USDC on its way`}
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
