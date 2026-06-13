"use client";

// WorldGate (DESIGN_BRIEF §3c-vi, §3b reviews) — the human gate, wired for real
// against World ID 4.0 (idkit v4, managed RP). world.rpContext() returns the
// backend-SIGNED rp_context {rp_id, nonce, created_at, expires_at, signature}
// (the widget can't open without it) plus app_id/action/environment. On success
// the whole v4 result goes to world.verify, which forwards it AS-IS to World's
// /api/v4/verify/{rp_id} and binds the RP-scoped nullifier. See [[world-id-v4-contract]].
//
// The idkit surface is loaded via next/dynamic({ssr:false}) — it runs on WASM
// that must instantiate in the browser only. It renders the QR INLINE off a
// freshly-fetched rp_context (short-lived signature → we refetch on expiry, and
// remount the widget by keying it on the nonce). idkit error codes are recovered
// where we can: an already-verified human (nullifier_replayed /
// max_verifications_reached) is reconciled against profile.me instead of dead-ending.
import dynamic from "next/dynamic";
import type { IDKitResult } from "@worldcoin/idkit";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlatformClient } from "./use-platform-client";
import { useHostAuth } from "../lib/use-host-auth";
import { EmojiToken, StickerButton } from "./ui/sticker";

const WorldGateWidget = dynamic(() => import("./world-gate-widget"), {
  ssr: false,
});

type RpContext = Awaited<
  ReturnType<ReturnType<typeof usePlatformClient>["world"]["rpContext"]>
>;
type VerifyArgs = Parameters<
  ReturnType<typeof usePlatformClient>["world"]["verify"]
>[0];

// "You already proved you're human" — World refuses a second proof for this
// action. Not a failure: reconcile against the backend instead of dead-ending.
const ALREADY_HUMAN = new Set(["nullifier_replayed", "max_verifications_reached"]);
// Stale/short-lived signature or a dropped bridge — refetch a fresh context and
// let the widget remount + re-open (capped so we never loop forever).
const TRANSIENT = new Set([
  "rp_signature_expired",
  "timestamp_too_old",
  "timestamp_too_far_in_future",
  "invalid_timestamp",
  "connection_failed",
  "timeout",
]);
const MAX_AUTO_REFETCH = 2;

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
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetches = useRef(0);

  const loadCtx = useCallback(async () => {
    try {
      const fresh = await client.world.rpContext();
      setCtx(fresh);
      setError(null);
    } catch {
      setError("World ID isn't available right now. Try again in a moment.");
    }
  }, [client]);

  // Warm a fresh context on mount so the QR can render immediately.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    client.world
      .rpContext()
      .then((c) => !cancelled && setCtx(c))
      .catch(
        () =>
          !cancelled &&
          setError("World ID isn't available right now. Try again in a moment.")
      );
    return () => {
      cancelled = true;
    };
  }, [client, isLoggedIn]);

  const handle = async (result: IDKitResult) => {
    setVerifying(true);
    setError(null);
    try {
      await client.world.verify({ result } as VerifyArgs);
      onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification didn't go through.");
    } finally {
      setVerifying(false);
    }
  };

  // idkit error codes — recover where we can instead of silently dying.
  const onWidgetError = async (code: string) => {
    console.error("[WorldID] connect error:", code);
    if (ALREADY_HUMAN.has(code)) {
      // World says this person already proved humanity. Our flag may just be
      // out of sync — re-check the backend; pass if it now agrees.
      try {
        const me = await client.profile.me();
        if (me.worldVerified) {
          onVerified();
          return;
        }
      } catch {
        // fall through to the friendly message
      }
      setError("You've already verified — give it a sec, then tap retry.");
      return;
    }
    if (TRANSIENT.has(code) && refetches.current < MAX_AUTO_REFETCH) {
      refetches.current += 1;
      void loadCtx();
      return;
    }
    setError(`World ID error: ${code}`);
  };

  const retry = () => {
    refetches.current = 0;
    setError(null);
    void loadCtx();
  };

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <EmojiToken emoji="🌍" color="green" size={64} />
      <div className="text-2xl font-extrabold">{title}</div>

      {!isLoggedIn ? (
        <div className="text-sm font-semibold text-muted">
          sign in first to verify
        </div>
      ) : ctx ? (
        <WorldGateWidget
          key={ctx.rpContext.nonce}
          appId={ctx.appId}
          action={ctx.action}
          rpContext={ctx.rpContext}
          environment={ctx.environment}
          allowLegacyProofs={ctx.allowLegacyProofs}
          verifying={verifying}
          onResult={handle}
          onError={onWidgetError}
        />
      ) : (
        <div className="w-52 h-52 bg-white border-[3px] border-ink rounded-toy-lg grid place-items-center shadow-sticker-lg">
          <span className="text-6xl animate-pulse text-muted">▦</span>
        </div>
      )}

      <div className="text-sm font-semibold text-muted">~30 seconds, one time</div>
      <div className="text-xs font-medium text-muted max-w-[280px]">{blurb}</div>
      {error && (
        <div className="flex flex-col items-center gap-2">
          <div className="text-pink text-small font-bold">{error}</div>
          <StickerButton color="yellow" size="sm" onClick={retry}>
            Try again
          </StickerButton>
        </div>
      )}
    </div>
  );
}
