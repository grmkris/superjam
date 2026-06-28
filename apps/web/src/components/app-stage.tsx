"use client";

// AppStage — the fullscreen presentation shell for a live jam, used by the
// /app/[slug] route (AppViewer). A portal'd `fixed inset-0` overlay on <body> so
// it paints above ALL chrome; the page underneath keeps its scroll position. A
// flex column: the shared JamChrome top bar (always visible) + the live app below
// it. The in-feed inline player (jam-feed-card) reuses JamChrome directly and
// handles its own fullscreen, so it does NOT mount AppStage.
//
// CRITICAL: the single <AppHost key="app-host"> mounts ONCE for the stage's
// lifetime — remounting the iframe would reload the app and drop its state.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppHost } from "./app-host";
import type { ViewerApp } from "./app-frame";
import { JamChrome } from "./jam-chrome";

export function AppStage({
  app,
  maker,
  onClose,
}: {
  app: ViewerApp;
  maker?: { username: string } | null;
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

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-cream motion-safe:animate-[fadein_0.18s_ease-out]">
      <div className="border-b border-line bg-cream/95">
        <JamChrome app={app} maker={maker} fullscreen onClose={onClose} />
      </div>
      <div className="relative min-h-0 flex-1 bg-card">
        <AppHost key="app-host" app={app} />
      </div>
    </div>,
    document.body
  );
}
