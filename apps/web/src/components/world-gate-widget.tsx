"use client";

// The idkit v4 verification surface, isolated in its own module so it can be
// loaded via next/dynamic({ ssr:false }) from world-gate.tsx — idkit-core runs
// on WASM (idkit_wasm_bg.wasm), which must instantiate in the BROWSER only,
// never during SSR/prerender. All @worldcoin/idkit imports live here for that.
//
// We use the HEADLESS `useIDKitRequest` hook (not the batteries-included modal
// widget) so the QR lives INLINE on the page: the hook hands back a
// `connectorURI` that we render as a real, scannable QR (react-qr-code) AND use
// as the World App deeplink for the "Scan with World App" button. open() kicks
// off the session on mount; the hook polls and surfaces result/error, which we
// forward up to world-gate.tsx (which owns the backend verify + onVerified).
import {
  proofOfHuman,
  useIDKitRequest,
  type IDKitResult,
} from "@worldcoin/idkit";
import { useEffect, useRef } from "react";
import QRCode from "react-qr-code";
import { FILL } from "./ui/sticker";
import { cx } from "./ui/cx";

export interface WorldGateWidgetProps {
  appId: string;
  action: string;
  rpContext: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  };
  environment: "staging" | "production";
  allowLegacyProofs: boolean;
  /** Parent is mid backend-verify — drives the button's "Verifying…" label. */
  verifying: boolean;
  onResult: (result: IDKitResult) => void;
  onError: (code: string) => void;
}

export default function WorldGateWidget({
  appId,
  action,
  rpContext,
  environment,
  allowLegacyProofs,
  verifying,
  onResult,
  onError,
}: WorldGateWidgetProps) {
  const {
    open,
    connectorURI,
    result,
    isSuccess,
    isError,
    errorCode,
    isInWorldApp,
  } = useIDKitRequest({
    app_id: appId as `app_${string}`,
    action,
    rp_context: rpContext,
    allow_legacy_proofs: allowLegacyProofs,
    environment,
    preset: proofOfHuman(),
  });

  // Kick off the session once per mount so connectorURI populates. A fresh
  // rp_context remounts this component (keyed by nonce in world-gate.tsx), so a
  // short-lived signature can never leave us polling a stale session.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open();
  }, [open]);

  // Forward a finished proof up to the parent's backend verify.
  useEffect(() => {
    if (isSuccess && result) onResult(result);
  }, [isSuccess, result, onResult]);

  // Forward idkit error codes (nullifier_replayed, connection/expiry, …) up —
  // world-gate.tsx decides how to react (recover vs. refetch vs. surface).
  useEffect(() => {
    if (isError && errorCode) onError(String(errorCode));
  }, [isError, errorCode, onError]);

  const ready = Boolean(connectorURI);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* The white frame is now the QR host, not a placeholder. */}
      <div className="w-52 h-52 bg-white border-[3px] border-ink rounded-toy-lg grid place-items-center shadow-sticker-lg overflow-hidden">
        {isInWorldApp ? (
          <span className="text-sm font-bold text-muted px-4 text-center">
            Confirm in World App…
          </span>
        ) : ready ? (
          <QRCode
            value={connectorURI!}
            size={176}
            level="M"
            bgColor="#ffffff"
            fgColor="#15131f"
            style={{ width: 176, height: 176 }}
          />
        ) : (
          <span className="text-6xl animate-pulse text-muted">▦</span>
        )}
      </div>

      {/* Deeplink: opens World App on the same device (mobile), or the world.org
          verify landing in a new tab (desktop) while the inline QR keeps polling. */}
      <a
        href={ready ? connectorURI! : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!ready || verifying}
        className={cx(
          "inline-flex items-center justify-center gap-2 border-2 border-ink font-extrabold",
          "sticker-press text-lg px-6 min-h-[54px] rounded-toy shadow-sticker-md",
          FILL.green,
          (!ready || verifying) &&
            "opacity-50 pointer-events-none active:translate-y-0"
        )}
      >
        {verifying
          ? "Verifying…"
          : ready
            ? "Scan with World App ✓"
            : "Connecting…"}
      </a>
    </div>
  );
}
