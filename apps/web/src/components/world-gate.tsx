"use client";

// WorldGate (DESIGN_BRIEF §3c-vi, §3b reviews) — the human gate.
//
// BLOCKED on a dependency decision, NOT design: the backend verifier
// (auth/world.ts) forwards the CLASSIC flat proof
// {merkle_root, nullifier_hash, proof, verification_level} to
// POST /api/v4/verify/{rp_id}, and world.rpContext returns {appId, action} for
// the classic <IDKitWidget app_id action onSuccess>. But the catalog's
// @worldcoin/idkit ^4.0.0 resolved to 4.1.8 — a NEW-protocol API (presets /
// rp_context / v3-v4 string[] proofs, `IDKitRequestWidget`/`useIDKitRequest`)
// that does NOT expose IDKitWidget/ISuccessResult and does NOT emit that flat
// shape. Wiring it would require either downgrading idkit to the classic
// IDKitWidget line (catalog/lock = A) or rewriting K's verifier for v4 proofs
// (closed lane). Until that's decided this gate is presentational: it consumes
// world.rpContext to prove the seam and continues the caller's action.
// TODO(world idkit version): once idkit exposes IDKitWidget again, render it
// here with app_id={ctx.appId} action={ctx.action} onSuccess → world.verify.
import { useEffect, useState } from "react";
import { usePlatformClient } from "./use-platform-client";
import { useHostAuth } from "../lib/use-host-auth";
import { EmojiToken, StickerButton } from "./ui/sticker";

export function WorldGate({
  onVerified,
  title = "Verify you're human to keep jamming",
  blurb = "keeps superjam human — no spam jams, no bot hi-scores.",
}: {
  onVerified: () => void;
  title?: string;
  blurb?: string;
}) {
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    client.world
      .rpContext()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        /* World not configured in this env */
      });
    return () => {
      cancelled = true;
    };
  }, [client, isLoggedIn]);

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <EmojiToken emoji="🌍" color="green" size={64} />
      <div className="text-2xl font-extrabold">{title}</div>
      <div className="w-52 h-52 bg-card border-[3px] border-ink rounded-toy-lg grid place-items-center text-6xl shadow-sticker-lg">
        ▦
      </div>
      <div className="text-sm font-semibold text-muted">
        scan with World App · ~30 seconds, one time
      </div>
      <div className="text-xs font-medium text-muted max-w-[280px]">{blurb}</div>
      <StickerButton
        color="green"
        size="lg"
        block
        onClick={onVerified}
        disabled={!isLoggedIn || !ready}
      >
        {ready ? "I'm verified ✓" : "…"}
      </StickerButton>
    </div>
  );
}
