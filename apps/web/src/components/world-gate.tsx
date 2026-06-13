"use client";

// WorldGate (DESIGN_BRIEF §3c-vi, §3b reviews) — the human gate, wired for real
// against World ID 4.0 (idkit v4, managed RP). world.rpContext() returns the
// backend-SIGNED rp_context {rp_id, nonce, created_at, expires_at, signature}
// (the widget can't open without it) plus app_id/action/environment. On success
// the whole v4 result goes to world.verify, which forwards it AS-IS to World's
// /api/v4/verify/{rp_id} and binds the RP-scoped nullifier. Fires once;
// onVerified continues the caller's action. See [[world-id-v4-contract]].
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
} from "@worldcoin/idkit";
import { useEffect, useState } from "react";
import { usePlatformClient } from "./use-platform-client";
import { useHostAuth } from "../lib/use-host-auth";
import { EmojiToken, StickerButton } from "./ui/sticker";

type RpContext = Awaited<
  ReturnType<ReturnType<typeof usePlatformClient>["world"]["rpContext"]>
>;
type VerifyArgs = Parameters<
  ReturnType<typeof usePlatformClient>["world"]["verify"]
>[0];

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
  const [ctx, setCtx] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    client.world
      .rpContext()
      .then((c) => {
        if (!cancelled) setCtx(c);
      })
      .catch(() => {
        if (!cancelled) setError("World ID isn't available right now.");
      });
    return () => {
      cancelled = true;
    };
  }, [client, isLoggedIn]);

  const handle = async (result: IDKitResult) => {
    setVerifying(true);
    setError(null);
    try {
      // v4-only (allow_legacy_proofs:false) → result is an IDKitResultV4 whose
      // shape matches the verify input; forward the whole thing for the backend
      // to validate against World + read the RP-scoped nullifier from responses.
      await client.world.verify({ result } as VerifyArgs);
      onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification didn't go through.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <EmojiToken emoji="🌍" color="green" size={64} />
      <div className="text-2xl font-extrabold">{title}</div>

      {!isLoggedIn ? (
        <div className="text-sm font-semibold text-muted">sign in first to verify</div>
      ) : !ctx ? (
        <div className="w-52 h-52 bg-card border-[3px] border-ink rounded-toy-lg grid place-items-center text-5xl shadow-sticker-lg animate-pulse">
          ▦
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="w-52 h-52 bg-card border-[3px] border-ink rounded-toy-lg grid place-items-center text-6xl shadow-sticker-lg sticker-press"
            aria-label="Open World ID"
          >
            ▦
          </button>
          <StickerButton
            color="green"
            size="lg"
            onClick={() => setOpen(true)}
            disabled={verifying}
          >
            {verifying ? "Verifying…" : "Scan with World App ✓"}
          </StickerButton>
          <IDKitRequestWidget
            app_id={ctx.appId as `app_${string}`}
            action={ctx.action}
            rp_context={ctx.rpContext}
            allow_legacy_proofs={ctx.allowLegacyProofs}
            environment={ctx.environment}
            preset={proofOfHuman()}
            open={open}
            onOpenChange={setOpen}
            onSuccess={handle}
          />
        </div>
      )}

      <div className="text-sm font-semibold text-muted">~30 seconds, one time</div>
      <div className="text-xs font-medium text-muted max-w-[280px]">{blurb}</div>
      {error && <div className="text-pink text-[13px] font-bold">{error}</div>}
    </div>
  );
}
