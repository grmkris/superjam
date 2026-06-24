"use client";

// JamFeedCard (DESIGN_BRIEF §3b) — one full-screen feed cell. Cells inside the
// mount window (active ± 1) play the jam LIVE via <AppHost> so neighbours are
// preloaded off-screen (no spinner on swipe); others render a cheap poster
// placeholder. The shared JamChrome top bar carries identity + all actions
// (like/comment/share/remix/menu) and a ⛶ that expands the SAME iframe to
// fullscreen (CSS only — no reload). Signed-out viewers see a sign-in CTA.
import type { AppId } from "@superjam/shared";
import { useEffect, useMemo, useState } from "react";
import { useLogin } from "../login";
import { usePlatformClient } from "../use-platform-client";
import { useHostAuth } from "../../lib/use-host-auth";
import Link from "next/link";
import { AppHost } from "../app-host";
import { JamChrome } from "../jam-chrome";
import { cx } from "../ui/cx";
import { EmojiToken, StickerButton } from "../ui/sticker";
import { avatarEmoji } from "../ui/identity";
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
  active,
  mounted,
  onFullscreenChange,
  onComments,
}: {
  jam: FeedJam;
  /** the cell snapped into view — drives URL + is the only one that can fullscreen */
  active: boolean;
  /** within the preload window (active ± 1) — mounts the live game off-screen */
  mounted: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onComments: (j: FeedJam) => void;
}) {
  const { isLoggedIn } = useHostAuth();
  const { openLogin } = useLogin();
  const client = usePlatformClient();
  const [liked, setLiked] = useState(jam.likedByMe);
  const [likes, setLikes] = useState(jam.likes);
  const [fullscreen, setFullscreen] = useState(false);

  // Stable ViewerApp identity so AppHost/AppFrame don't re-run their effects each
  // render (jam is stable while the feed list is).
  const viewerApp = useMemo(() => toViewerApp(jam), [jam]);

  // Preloaded cells (active or neighbour) play live; the jam's SDK needs a token.
  const live = mounted && isLoggedIn;

  // A cell that scrolls away while fullscreen must drop fullscreen.
  useEffect(() => {
    if (!active && fullscreen) setFullscreen(false);
  }, [active, fullscreen]);

  // Notify the page (hide tabs) + lock body scroll while fullscreen; Esc exits.
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
        // Inline it fills the cell as a flex column (top bar + app); fullscreen
        // flips the SAME subtree to fixed inset-0 (no remount → jam keeps state).
        <div
          className={cx(
            "flex flex-col bg-ink",
            fullscreen ? "fixed inset-0 z-[100]" : "absolute inset-0"
          )}
        >
          <div className={fullscreen ? "border-b border-ink/60" : "border-b-2 border-ink bg-cream/95"}>
            <JamChrome
              app={viewerApp}
              maker={{ username: jam.maker.username }}
              fullscreen={fullscreen}
              onFullscreen={() => setFullscreen(true)}
              onClose={() => setFullscreen(false)}
              likes={likes}
              liked={liked}
              onLike={onLike}
              comments={jam.comments}
              onComments={() => onComments(jam)}
            />
          </div>
          <div className="relative min-h-0 flex-1">
            <AppHost key="app-host" app={viewerApp} />
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
    </section>
  );
}
