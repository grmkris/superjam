"use client";

// AppStage — the fullscreen presentation shell for a live jam. A portal'd
// `fixed inset-0` overlay mounted on <body>, so it paints above ALL chrome
// (BottomNav, SideNav, the feed's tab pills) regardless of any
// transformed/overflow ancestor, and the feed/page underneath keeps its scroll
// position — closing returns the user exactly where they were. The shell is a
// flex column: a slim solid top bar (identity pill + ✕) that owns its own height
// and is ALWAYS visible, with the live app filling the rest BELOW it. The bar
// does not float over the app, so app content can never overflow above it.
//
// CRITICAL: the single <AppHost key="app-host"> mounts ONCE for the stage's
// lifetime. The framed app does a one-time host.hello handshake and caches it;
// remounting the iframe would reload the app and drop its state.
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppHost } from "./app-host";
import type { ViewerApp } from "./app-frame";
import { cx } from "./ui/cx";

const PILL =
  "inline-flex items-center gap-2 bg-white/85 backdrop-blur border-2 border-ink rounded-full text-small font-bold shadow-sticker-sm";

export function AppStage({
  app,
  maker,
  titleHref,
  onClose,
}: {
  app: ViewerApp;
  maker?: { username: string } | null;
  /** if set, the identity pill links to the jam page (e.g. /j/<slug>) */
  titleHref?: string;
  onClose: () => void;
}) {
  // Portal needs `document`; gate on mount so SSR/first paint is a no-op.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Lock background scroll while the stage owns the screen.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc closes — matches the ✕ affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  // emoji + name (+ optional muted @maker as plain text — kept inside the single
  // anchor to avoid nesting <a> in <a>).
  const identity = (
    <>
      <span className="shrink-0">{app.iconEmoji}</span>
      <span className="truncate">{app.name}</span>
      {maker && <span className="shrink-0 font-semibold text-muted">@{maker.username}</span>}
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-ink motion-safe:animate-[fadein_0.18s_ease-out]">
      {/* solid top bar — owns its height and is always visible; the app sits
          strictly below it and can never overflow above it. */}
      <div className="z-10 flex items-center gap-2.5 border-b border-ink/60 px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        {titleHref ? (
          <Link href={titleHref} className={cx(PILL, "focus-ring sticker-press min-w-0 px-3.5 py-1.5")}>
            {identity}
          </Link>
        ) : (
          <span className={cx(PILL, "min-w-0 px-3.5 py-1.5")}>{identity}</span>
        )}
        <button
          onClick={onClose}
          aria-label="Close jam"
          className={cx(
            PILL,
            "focus-ring ml-auto flex size-[38px] shrink-0 items-center justify-center text-body font-extrabold sticker-press"
          )}
        >
          ✕
        </button>
      </div>

      {/* live app fills the remaining height, bounded below the bar */}
      <div className="relative min-h-0 flex-1">
        <AppHost key="app-host" app={app} />
      </div>
    </div>,
    document.body
  );
}
