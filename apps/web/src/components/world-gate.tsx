"use client";

// WorldGate (DESIGN_BRIEF §3c-vi, §3b reviews) — the human gate, wired for real
// against World ID 4.0 (idkit v4, managed RP). world.rpContext() returns the
// backend-SIGNED rp_context {rp_id, nonce, created_at, expires_at, signature}
// (the widget can't open without it) plus app_id/action/environment. On success
// the whole v4 result goes to world.verify, which forwards it AS-IS to World's
// /api/v4/verify/{rp_id} and binds the RP-scoped nullifier. See [[world-id-v4-contract]].
//
// The idkit widget is loaded via next/dynamic({ssr:false}) — it runs on WASM that
// must instantiate in the browser only. A FRESH rp_context is fetched on each open
// (its signature is short-lived), and onError surfaces connect failures (idkit
// fails silently otherwise — the "nothing happens on click" trap).
import dynamic from "next/dynamic";
import type { IDKitResult } from "@worldcoin/idkit";
import { useEffect, useState } from "react";
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
  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Warm a context on mount so the button can render immediately.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    client.world
      .rpContext()
      .then((c) => !cancelled && setCtx(c))
      .catch(() => !cancelled && setError("World ID isn't available right now."));
    return () => {
      cancelled = true;
    };
  }, [client, isLoggedIn]);

  // Open: refetch a fresh rp_context (its signature is short-lived) THEN open the
  // widget, so a stale/expired context can never silently kill the connect.
  const openWidget = async () => {
    setError(null);
    setConnecting(true);
    try {
      const fresh = await client.world.rpContext();
      setCtx(fresh);
      setOpen(true);
    } catch {
      setError("Couldn't start World ID. Try again in a moment.");
    } finally {
      setConnecting(false);
    }
  };

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

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <EmojiToken emoji="🌍" color="green" size={64} />
      <div className="text-2xl font-extrabold">{title}</div>

      {!isLoggedIn ? (
        <div className="text-sm font-semibold text-muted">sign in first to verify</div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={openWidget}
            disabled={connecting || verifying}
            className="w-52 h-52 bg-card border-[3px] border-ink rounded-toy-lg grid place-items-center text-6xl shadow-sticker-lg sticker-press disabled:opacity-60"
            aria-label="Open World ID"
          >
            {connecting ? <span className="animate-pulse">▦</span> : "▦"}
          </button>
          <StickerButton
            color="green"
            size="lg"
            onClick={openWidget}
            disabled={connecting || verifying}
          >
            {connecting
              ? "Connecting…"
              : verifying
                ? "Verifying…"
                : "Scan with World App ✓"}
          </StickerButton>
          {ctx && (
            <WorldGateWidget
              appId={ctx.appId}
              action={ctx.action}
              rpContext={ctx.rpContext}
              environment={ctx.environment}
              allowLegacyProofs={ctx.allowLegacyProofs}
              open={open}
              onOpenChange={setOpen}
              onResult={handle}
              onError={(code) => {
                // idkit IDKitErrorCodes — surface instead of silently dying.
                console.error("[WorldID] connect error:", code);
                setError(`World ID error: ${code}`);
                setOpen(false);
              }}
            />
          )}
        </div>
      )}

      <div className="text-sm font-semibold text-muted">~30 seconds, one time</div>
      <div className="text-xs font-medium text-muted max-w-[280px]">{blurb}</div>
      {error && <div className="text-pink text-small font-bold">{error}</div>}
    </div>
  );
}
