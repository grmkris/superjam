"use client";

// AppStage — the fullscreen presentation shell for a live jam. A portal'd
// `fixed inset-0` overlay mounted on <body>, so it paints above ALL chrome
// (BottomNav, SideNav, the feed's tab pills) regardless of any
// transformed/overflow ancestor, and the feed/page underneath keeps its scroll
// position — closing returns the user exactly where they were. The shell is a
// flex column: a slim solid top bar (identity chip + action cluster) that owns
// its own height and is ALWAYS visible, with the live app filling the rest
// BELOW it. The bar does not float over the app, so app content can never
// overflow above it.
//
// The bar is a superapp-style capsule: tap the identity chip OR ⋯ to open an
// actions sheet (Creator, Jam page, Remix, Share) that overlays the LIVE jam
// without tearing it down; 📣 shares in one tap; ✕ closes. Only navigating away
// (a sheet link) unmounts the running jam — by deliberate user choice.
//
// CRITICAL: the single <AppHost key="app-host"> mounts ONCE for the stage's
// lifetime. The framed app does a one-time host.hello handshake and caches it;
// remounting the iframe would reload the app and drop its state.
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppHost } from "./app-host";
import type { ViewerApp } from "./app-frame";
import { FriendPicker } from "./chat/friend-picker";
import { ToyboxSheet } from "./ui/sheet";
import { EmojiToken, StickerButton } from "./ui/sticker";
import { cx } from "./ui/cx";

const PILL =
  "inline-flex items-center bg-white/85 backdrop-blur border-2 border-ink rounded-full text-small font-bold shadow-sticker-sm sticker-press focus-ring";
// circular icon button in the right-hand action cluster
const ICON_PILL = cx(PILL, "size-8 shrink-0 justify-center text-body");

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

  // Bar interactions: ⋯ actions sheet and the share (FriendPicker) sheet.
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);

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

  const openShare = () => {
    setMenuOpen(false);
    setPicking(true);
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] flex flex-col bg-ink motion-safe:animate-[fadein_0.18s_ease-out]">
        {/* slim solid top bar — owns its height and is always visible; the app
            sits strictly below it and can never overflow above it. */}
        <div className="z-10 flex items-center gap-2 border-b border-ink/60 px-3 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))]">
          {/* identity chip — tap to open the app actions sheet (not a nav, so
              the running jam stays alive). */}
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="App menu"
            className={cx(PILL, "min-w-0 gap-2 px-3 py-1")}
          >
            <span className="shrink-0">{app.iconEmoji}</span>
            <span className="truncate">{app.name}</span>
            {maker && (
              <span className="shrink-0 font-semibold text-muted">@{maker.username}</span>
            )}
          </button>

          {/* right action cluster */}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={openShare} aria-label="Share jam" className={ICON_PILL}>
              📣
            </button>
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="More"
              className={cx(ICON_PILL, "font-extrabold")}
            >
              ⋯
            </button>
            <button
              onClick={onClose}
              aria-label="Close jam"
              className={cx(ICON_PILL, "font-extrabold")}
            >
              ✕
            </button>
          </div>
        </div>

        {/* live app fills the remaining height, bounded below the bar */}
        <div className="relative min-h-0 flex-1">
          <AppHost key="app-host" app={app} />
        </div>
      </div>

      <AppMenuSheet
        app={app}
        maker={maker}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onShare={openShare}
      />

      {picking && (
        <FriendPicker
          jamSlug={app.slug}
          shareUrl={`${window.location.origin}/j/${app.slug}`}
          onClose={() => setPicking(false)}
        />
      )}
    </>,
    document.body
  );
}

// AppMenuSheet — the ⋯ actions sheet, overlaid on the LIVE jam. Each row is
// derived from `app`/`maker`; the link rows DO navigate away (unmounting the
// running jam) by deliberate user choice. Share opens the FriendPicker instead.
function AppMenuSheet({
  app,
  maker,
  open,
  onOpenChange,
  onShare,
}: {
  app: ViewerApp;
  maker?: { username: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShare: () => void;
}) {
  const rowClass =
    "focus-ring sticker-press flex w-full items-center gap-3 rounded-toy border-2 border-ink bg-card p-3 text-left shadow-sticker-sm";

  return (
    <ToyboxSheet open={open} onOpenChange={onOpenChange} title={`${app.name} menu`}>
      <div className="flex items-center gap-3">
        <EmojiToken emoji={app.iconEmoji} color="blue" size={48} rounded="toy" />
        <div className="min-w-0">
          <div className="truncate text-h3 font-extrabold">{app.name}</div>
          {maker && <div className="text-small font-semibold text-muted">@{maker.username}</div>}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {maker && (
          <Link href={`/u/${maker.username}`} className={rowClass}>
            <EmojiToken emoji="👤" color="green" size={36} />
            <span className="font-extrabold">@{maker.username}</span>
          </Link>
        )}
        <Link href={`/j/${app.slug}`} className={rowClass}>
          <EmojiToken emoji="💬" color="yellow" size={36} />
          <span className="font-extrabold">Jam page &amp; reviews</span>
        </Link>
        <Link href={`/build?remix=${app.slug}`} className={rowClass}>
          <EmojiToken emoji="🔁" color="lavender" size={36} />
          <span className="font-extrabold">Remix this jam</span>
        </Link>
        <button onClick={onShare} className={rowClass}>
          <EmojiToken emoji="📣" color="pink" size={36} />
          <span className="font-extrabold">Send / Challenge a friend</span>
        </button>
      </div>

      <StickerButton color="white" size="md" block onClick={() => onOpenChange(false)}>
        Cancel
      </StickerButton>
    </ToyboxSheet>
  );
}
