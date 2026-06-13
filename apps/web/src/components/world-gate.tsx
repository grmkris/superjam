"use client";

// WorldGate (DESIGN_BRIEF §3c-vi, §3b reviews) — the human gate, wired for real
// against the classic IDKit Incognito-Actions flow that K's backend verifies:
// world.rpContext → {appId, action} boots the widget; on success the flat proof
// {merkle_root, nullifier_hash, proof, verification_level} goes to world.verify,
// which forwards it AS-IS to the World developer portal (auth/world.ts). Fires
// once; onVerified continues the caller's action.
//
// Note on the dep: @worldcoin/idkit is pinned to the classic ^2.x line — v4.x is
// a different (World ID protocol) SDK whose request needs an RP-ECDSA-signed
// rp_context the backend doesn't issue, and whose string[] proofs the portal
// cloud-verify doesn't accept. 2.4.2 peers react >18 so React 19 is fine.
import { IDKitWidget, type ISuccessResult } from "@worldcoin/idkit";
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
  const [ctx, setCtx] = useState<{ appId: string; action: string } | null>(null);
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

  const handle = async (result: ISuccessResult) => {
    setVerifying(true);
    setError(null);
    try {
      await client.world.verify({
        proof: {
          merkle_root: result.merkle_root,
          nullifier_hash: result.nullifier_hash,
          proof: result.proof,
          verification_level: result.verification_level,
        },
      });
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
        <IDKitWidget
          app_id={ctx.appId as `app_${string}`}
          action={ctx.action}
          onSuccess={handle}
        >
          {({ open }: { open: () => void }) => (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={open}
                className="w-52 h-52 bg-card border-[3px] border-ink rounded-toy-lg grid place-items-center text-6xl shadow-sticker-lg sticker-press"
                aria-label="Open World ID"
              >
                ▦
              </button>
              <StickerButton color="green" size="lg" onClick={open} disabled={verifying}>
                {verifying ? "Verifying…" : "Scan with World App ✓"}
              </StickerButton>
            </div>
          )}
        </IDKitWidget>
      )}

      <div className="text-sm font-semibold text-muted">~30 seconds, one time</div>
      <div className="text-xs font-medium text-muted max-w-[280px]">{blurb}</div>
      {error && <div className="text-pink text-[13px] font-bold">{error}</div>}
    </div>
  );
}
