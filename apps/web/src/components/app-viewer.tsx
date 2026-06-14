"use client";

// AppViewer — the super-app host view for /app/[slug]. Opening a jam by URL lands
// here: the app runs WINDOWED inside the Toybox phone column (same chrome as the
// rest of the product), exactly like tapping ▸ Play in the feed. A ⛶ button blows
// it up to true full-bleed, ⤢ brings it back. AppChrome leaves /app/* full-bleed,
// so this view owns its whole layout — windowed shell vs. edge-to-edge.
//
// CRITICAL: the single <AppHost> element stays mounted across the toggle (stable
// position + key). The framed app does a one-time host.hello handshake and caches
// it; remounting the iframe would reload the app and drop its state. Only the
// surrounding wrapper className + the conditional header/nav/exit chrome change.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHost } from "./app-host";
import type { ViewerApp } from "./app-frame";
import { BottomNav } from "./bottom-nav";
import { cx } from "./ui/cx";

const CHROME_BTN =
  "focus-ring flex items-center justify-center size-[38px] rounded-full bg-card border-2 border-ink text-body font-extrabold sticker-press shrink-0";

export function AppViewer({ app }: { app: ViewerApp }) {
  const router = useRouter();
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <div
      className={cx(
        fullscreen
          ? "app-bleed relative"
          : "app-shell flex flex-col h-[100dvh] overflow-hidden"
      )}
    >
      {!fullscreen && (
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-2 shrink-0">
          <Link
            href={`/j/${app.slug}`}
            className="focus-ring inline-flex items-center gap-2 bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-small font-bold sticker-press min-w-0"
          >
            <span className="shrink-0">{app.iconEmoji}</span>
            <span className="truncate">{app.name}</span>
          </Link>
          <button
            onClick={() => setFullscreen(true)}
            aria-label="Fullscreen"
            className={cx(CHROME_BTN, "ml-auto")}
          >
            ⛶
          </button>
          <button
            onClick={() => router.push("/")}
            aria-label="Close jam"
            className={CHROME_BTN}
          >
            ✕
          </button>
        </div>
      )}

      <div
        className={cx(
          fullscreen
            ? "h-full"
            : "flex-1 min-h-0 mx-3 mb-3 border-2 border-ink rounded-toy-lg overflow-hidden bg-card"
        )}
      >
        <AppHost key="app-host" app={app} />
      </div>

      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          aria-label="Exit fullscreen"
          className={cx(CHROME_BTN, "absolute top-3 right-3 z-10 shadow-sticker-sm")}
        >
          ⤢
        </button>
      )}

      {!fullscreen && <BottomNav />}
    </div>
  );
}
