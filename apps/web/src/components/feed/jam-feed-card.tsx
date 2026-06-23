"use client";

// JamFeedCard (DESIGN_BRIEF §3b) — one full-screen feed cell. The ACTIVE cell
// (snapped into view) plays the jam LIVE inline via <AppHost> — no cover, no
// "Play now" gate (the differentiator vs TikTok: a real app, not a video).
// Inactive cells render a cheap poster placeholder (no iframe — only the active
// cell mounts one). A ⛶ button expands the SAME iframe to fullscreen (CSS only,
// so the jam never reloads); the top bar stays in fullscreen. Signed-out viewers
// see a sign-in CTA (the jam's SDK needs an app token).
import type { AppId } from "@superjam/shared";
import { useEffect, useState } from "react";
import { useLogin } from "../login";
import { usePlatformClient } from "../use-platform-client";
import { useHostAuth } from "../../lib/use-host-auth";
import Link from "next/link";
import { AppHost } from "../app-host";
import { JamChrome } from "../jam-chrome";
import { FriendPicker } from "../chat/friend-picker";
import { cx } from "../ui/cx";
import { EmojiToken, StickerButton } from "../ui/sticker";
import { avatarEmoji } from "../ui/identity";
import { FeedActionRail } from "./feed-action-rail";
import { type FeedJam, toViewerApp } from "./jam";

// diagonal candy gradient per accent (poster placeholder backdrop)
const ACCENT_GRADIENT: Record<FeedJam["accent"], string> = {
  blue: "from-blue via-blue to-pink",
  pink: "from-pink via-pink to-blue",
  green: "from-green via-green to-yellow",
  yellow: "from-yellow via-yellow to-green",
};
const ACCENT_TITLE: Record<FeedJam["accent"], string> = {
  blue: "text-white",
  pink: "text-white",
  green: "text-ink",
  yellow: "text-ink",
};

export function JamFeedCard({
  jam,
  next,
  active,
  onFullscreenChange,
  onComments,
  onRemix,
}: {
  jam: FeedJam;
  next: FeedJam | null;
  /** this cell is the one snapped into view — only the active cell plays live */
  active: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onComments: (j: FeedJam) => void;
  onRemix: (j: FeedJam) => void;
}) {
  const { isLoggedIn } = useHostAuth();
  const { openLogin } = useLogin();
  const client = usePlatformClient();
  const [liked, setLiked] = useState(jam.likedByMe);
  const [likes, setLikes] = useState(jam.likes);
  const [picking, setPicking] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Live game only on the active, signed-in cell (the jam's SDK needs a token).
  const live = active && isLoggedIn;

  // A cell that scrolls away while fullscreen must drop fullscreen.
  useEffect(() => {
    if (!active && fullscreen) setFullscreen(false);
  }, [active, fullscreen]);

  // Notify the page (hide tab pills) + lock body scroll while fullscreen; Esc exits.
  useEffect(() => {
    onFullscreenChange?.(fullscreen);
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen, onFullscreenChange]);

  // Like requires identity. Optimistic toggle, reconciled with the server.
  const onLike = () => {
    if (!isLoggedIn) {
      openLogin();
      return;
    }
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikes((n) => n + (nextLiked ? 1 : -1));
    client.apps
      .like({ appId: jam.id as AppId })
      .then((r) => {
        setLiked(r.liked);
        setLikes(r.likes);
      })
      .catch(() => {
        setLiked(!nextLiked);
        setLikes((n) => n + (nextLiked ? -1 : 1));
      });
  };

  return (
    <section data-slug={jam.slug} className="relative h-full snap-start overflow-hidden bg-ink">
      {live ? (
        // The live game. Inline it fills the cell as a flex column (top bar +
        // app); fullscreen flips the SAME subtree to fixed inset-0 (no remount →
        // the jam keeps its state). AppHost is keyed so it mounts once per cell.
        <div
          className={cx(
            "flex flex-col bg-ink",
            fullscreen ? "fixed inset-0 z-[100]" : "absolute inset-0"
          )}
        >
          <div className="border-b border-ink/60">
            <JamChrome
              app={toViewerApp(jam)}
              maker={{ username: jam.maker.username }}
              fullscreen={fullscreen}
              onFullscreen={() => setFullscreen(true)}
              onClose={() => setFullscreen(false)}
            />
          </div>
          <div className="relative min-h-0 flex-1">
            <AppHost key="app-host" app={toViewerApp(jam)} />
          </div>
        </div>
      ) : (
        // Poster placeholder — no iframe. Active-but-signed-out gets a sign-in CTA.
        <div
          className={cx(
            "absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center bg-gradient-to-br",
            ACCENT_GRADIENT[jam.accent]
          )}
        >
          <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
            <div
              className="absolute inset-0"
              style={{ backgroundImage: "var(--dots)", backgroundSize: "var(--dots-size)" }}
            />
            <span className="absolute -right-10 -top-8 rotate-12 select-none text-[12rem] leading-none opacity-10">
              {jam.iconEmoji}
            </span>
          </div>
          <EmojiToken emoji={jam.iconEmoji} color="yellow" size={120} rounded="toy" tilt={-5} className="shadow-sticker-lg" />
          <div className={cx("text-h2 font-extrabold ink-drop", ACCENT_TITLE[jam.accent])}>
            {jam.name}
          </div>
          <Link
            href={`/u/${jam.maker.username}`}
            className="focus-ring inline-flex items-center gap-1.5 bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-small font-bold shadow-sticker-sm sticker-press"
          >
            <EmojiToken emoji={avatarEmoji(jam.maker.username)} color="green" size={20} />
            <span className="font-bold">@{jam.maker.username}</span>
          </Link>
          {active && !isLoggedIn && (
            <StickerButton color="pink" size="lg" onClick={() => openLogin()} className="rounded-full px-9 shadow-sticker-lg">
              ▸ Sign in to play
            </StickerButton>
          )}
        </div>
      )}

      {/* feed action rail — over the game/poster, hidden in fullscreen */}
      {!fullscreen && (
        <div className="absolute right-3.5 bottom-32 z-20">
          <FeedActionRail
            likes={likes}
            comments={jam.comments}
            liked={liked}
            onLike={onLike}
            onComments={() => onComments(jam)}
            onShare={() => setPicking(true)}
            onRemix={() => onRemix(jam)}
          />
        </div>
      )}

      {/* next jam peeking in from below (swipe hint) */}
      {next && !fullscreen && (
        <button
          onClick={() => onComments(next)}
          className="absolute left-3.5 right-3.5 bottom-0 z-20 flex items-center gap-3 bg-green border-[2.5px] border-b-0 border-ink rounded-t-toy-lg px-4 pt-3 pb-5 text-left"
        >
          <EmojiToken emoji={next.iconEmoji} color="cream" size={40} rounded="toy" />
          <span className="flex flex-col">
            <span className="font-extrabold text-body text-ink">
              {next.name}{" "}
              <span className="font-semibold text-green-deep">· @{next.maker.username}</span>
            </span>
            <span className="text-xs font-bold text-green-deep">↑ swipe for the next jam</span>
          </span>
        </button>
      )}

      {picking && (
        <FriendPicker
          jamSlug={jam.slug}
          shareUrl={`${window.location.origin}/app/${jam.slug}`}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
