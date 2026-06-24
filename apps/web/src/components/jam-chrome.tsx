"use client";

// JamChrome — the shared top-bar + action sheets for a LIVE jam, used both by the
// inline feed player (jam-feed-card) and the fullscreen AppStage (/app/[slug]).
// A slim capsule bar: identity chip (→ actions sheet), 📣 share (→ FriendPicker),
// ⋯ menu (→ actions sheet), and a right-most control that is ⛶ enter-fullscreen
// when inline, or ✕ close when fullscreen. The sheets render above the stage
// (ToyboxSheet is z-[200]) so they're never hidden behind the running jam.
import Link from "next/link";
import { type ReactNode, useState } from "react";
import type { ViewerApp } from "./app-frame";
import { FriendPicker } from "./chat/friend-picker";
import { compactCount } from "./feed/jam";
import { ToyboxSheet } from "./ui/sheet";
import { actionRowButton, EmojiToken, StickerButton } from "./ui/sticker";
import { cx } from "./ui/cx";

const PILL =
  "inline-flex items-center bg-white/85 backdrop-blur border-2 border-ink rounded-full text-small font-bold shadow-sticker-sm sticker-press focus-ring";
const ICON_PILL = cx(PILL, "size-8 shrink-0 justify-center text-body");
// emoji + count pill (like / comment)
const COUNT_PILL = cx(PILL, "shrink-0 gap-1 px-2.5 py-1 text-tiny");

export function JamChrome({
  app,
  maker,
  fullscreen,
  onFullscreen,
  onClose,
  likes,
  liked,
  onLike,
  comments,
  onComments,
  profile,
}: {
  app: ViewerApp;
  maker?: { username: string } | null;
  fullscreen: boolean;
  /** enter fullscreen — shown as ⛶ when inline (only when provided) */
  onFullscreen?: () => void;
  /** close — shown as ✕ when fullscreen (only when provided) */
  onClose?: () => void;
  /** like + comment pills render only when their handler is provided (feed only). */
  likes?: number;
  liked?: boolean;
  onLike?: () => void;
  comments?: number;
  onComments?: () => void;
  /** identity surface (avatar/menu) docked at the far right — feed bar only. */
  profile?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  return (
    <>
      <div className="z-10 flex items-center gap-2 px-3 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))]">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="App menu"
          className={cx(PILL, "min-w-0 max-w-[44vw] gap-2 px-3 py-1 sm:max-w-none")}
        >
          <span className="shrink-0">{app.iconEmoji}</span>
          <span className="truncate">{app.name}</span>
          {maker && (
            <span className="shrink-0 font-semibold text-muted">@{maker.username}</span>
          )}
        </button>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          {onLike && (
            <button
              onClick={onLike}
              aria-label="Like"
              aria-pressed={liked}
              className={cx(COUNT_PILL, liked && "bg-pink text-white")}
            >
              <span>{liked ? "❤️" : "🤍"}</span>
              <span className="hidden sm:inline">{compactCount(likes ?? 0)}</span>
            </button>
          )}
          {onComments && (
            <button onClick={onComments} aria-label="Comments" className={COUNT_PILL}>
              <span>💬</span>
              <span className="hidden sm:inline">{compactCount(comments ?? 0)}</span>
            </button>
          )}
          <button onClick={() => setPicking(true)} aria-label="Share jam" className={ICON_PILL}>
            📣
          </button>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="More"
            className={cx(ICON_PILL, "font-extrabold")}
          >
            ⋯
          </button>
          {fullscreen
            ? onClose && (
                <button
                  onClick={onClose}
                  aria-label="Close jam"
                  className={cx(ICON_PILL, "font-extrabold")}
                >
                  ✕
                </button>
              )
            : onFullscreen && (
                <button
                  onClick={onFullscreen}
                  aria-label="Fullscreen"
                  className={cx(ICON_PILL, "font-extrabold")}
                >
                  ⛶
                </button>
              )}
          {profile}
        </div>
      </div>

      <AppMenuSheet app={app} maker={maker} open={menuOpen} onOpenChange={setMenuOpen} />

      {picking && (
        <FriendPicker
          jamSlug={app.slug}
          shareUrl={`${window.location.origin}/app/${app.slug}`}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

// AppMenuSheet — the ⋯ actions sheet, overlaid on the LIVE jam. The link rows DO
// navigate away (unmounting the running jam) by deliberate user choice.
function AppMenuSheet({
  app,
  maker,
  open,
  onOpenChange,
}: {
  app: ViewerApp;
  maker?: { username: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
          <Link href={`/u/${maker.username}`} className={actionRowButton}>
            <EmojiToken emoji="👤" color="green" size={36} />
            <span className="font-extrabold">@{maker.username}</span>
          </Link>
        )}
        <Link href={`/j/${app.slug}`} className={actionRowButton}>
          <EmojiToken emoji="💬" color="yellow" size={36} />
          <span className="font-extrabold">Jam page &amp; reviews</span>
        </Link>
        <Link href={`/build?remix=${app.slug}`} className={actionRowButton}>
          <EmojiToken emoji="🔁" color="lavender" size={36} />
          <span className="font-extrabold">Remix this jam</span>
        </Link>
      </div>

      <StickerButton color="white" size="md" block onClick={() => onOpenChange(false)}>
        Cancel
      </StickerButton>
    </ToyboxSheet>
  );
}
