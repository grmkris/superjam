"use client";

// JamFeedCard (DESIGN_BRIEF §3b) — one full-screen feed cell. Two modes:
//   poster   the play surface, maker, remix chip, tagline, ▸ Play now, rail
//   playing  the jam runs LIVE in-feed via %67's <AppHost> (a real app, not a
//            video — the differentiator vs TikTok)
// The ENS name tag lives on the jam PAGE, not the card (design round 6).
import type { AppId } from "@superjam/shared";
import { useState } from "react";
import { useLogin } from "../login";
import { usePlatformClient } from "../use-platform-client";
import { useHostAuth } from "../../lib/use-host-auth";
import { AppHost } from "../app-host";
import { FriendPicker } from "../chat/friend-picker";
import { Handle } from "../verified-badge";
import { cx } from "../ui/cx";
import { EmojiToken } from "../ui/sticker";
import { FeedActionRail } from "./feed-action-rail";
import { type FeedJam, toViewerApp } from "./jam";

const ACCENT_BG: Record<FeedJam["accent"], string> = {
  blue: "bg-blue",
  pink: "bg-pink",
  green: "bg-green",
  yellow: "bg-yellow",
};
// title colour that stays legible on each accent
const ACCENT_TITLE: Record<FeedJam["accent"], string> = {
  blue: "text-white",
  pink: "text-white",
  green: "text-ink",
  yellow: "text-ink",
};

export function JamFeedCard({
  jam,
  next,
  onPlayingChange,
  onComments,
  onRemix,
}: {
  jam: FeedJam;
  next: FeedJam | null;
  onPlayingChange?: (playing: boolean) => void;
  onComments: (j: FeedJam) => void;
  onRemix: (j: FeedJam) => void;
}) {
  const { isLoggedIn } = useHostAuth();
  const { openLogin } = useLogin();
  const client = usePlatformClient();
  const [playing, setPlaying] = useState(false);
  const [liked, setLiked] = useState(jam.likedByMe);
  const [likes, setLikes] = useState(jam.likes);
  const [picking, setPicking] = useState(false);

  // Like requires identity. Optimistic toggle, reconciled with the server's
  // authoritative {liked, likes}; revert on failure.
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

  // toggle play AND notify the feed page so it can hide the floating tab pills
  const setPlay = (v: boolean) => {
    setPlaying(v);
    onPlayingChange?.(v);
  };

  // Playing needs an identity: a signed-out viewer gets no app token, so the
  // jam's SDK calls fail with "Authentication required". Prompt sign-in first.
  const onPlay = () => {
    if (!isLoggedIn) {
      openLogin();
      return;
    }
    setPlay(true);
  };

  if (playing) {
    return (
      <section className={cx("relative h-full snap-start flex flex-col", ACCENT_BG[jam.accent])}>
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-2">
          <span className="inline-flex items-center gap-2 bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-small font-bold">
            <span>{jam.iconEmoji}</span>
            <span>{jam.name}</span>
            <Handle username={jam.maker.username} verified={jam.maker.verified} muted />
          </span>
          <button
            onClick={() => setPlay(false)}
            aria-label="Close jam"
            className="focus-ring ml-auto flex items-center justify-center size-[38px] rounded-full bg-card border-2 border-ink text-body font-extrabold sticker-press"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 mx-3 mb-3 border-2 border-ink rounded-toy-lg overflow-hidden bg-card">
          <AppHost app={toViewerApp(jam)} />
        </div>
      </section>
    );
  }

  return (
    <section
      className={cx(
        "relative h-full snap-start flex flex-col items-center justify-center gap-4 px-6 pt-24 pb-28 overflow-hidden",
        ACCENT_BG[jam.accent]
      )}
    >
      <EmojiToken emoji={jam.iconEmoji} color="yellow" size={140} rounded="toy" tilt={-5} className="shadow-sticker-lg" />

      <div className="flex flex-col items-center gap-1.5">
        <div className={cx("text-h1 font-extrabold ink-drop", ACCENT_TITLE[jam.accent])}>
          {jam.name}
        </div>
        <span className="inline-flex items-center gap-1.5 bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-small font-bold">
          <EmojiToken emoji="🦊" color="green" size={20} />
          <Handle username={jam.maker.username} verified={jam.maker.verified} />
        </span>
        {jam.remixOf && (
          <span className="inline-flex items-center gap-1 bg-card/90 border-2 border-ink rounded-full px-2.5 py-1 text-tiny font-extrabold">
            🔁 remix of {jam.remixOf.name} <span className="text-blue">↗</span>
          </span>
        )}
      </div>

      <div className="max-w-[280px] bg-card/95 border-2 border-ink rounded-2xl shadow-sticker px-4 py-2.5 text-center text-body font-semibold leading-snug">
        “{jam.tagline}”
      </div>

      <button
        onClick={onPlay}
        className="focus-ring inline-flex items-center gap-2 bg-pink text-white border-[2.5px] border-ink rounded-full px-9 py-3.5 text-lg font-extrabold shadow-sticker-lg sticker-press"
      >
        ▸ Play now
      </button>

      {jam.friendsLiked > 0 && (
        <div className="flex items-center gap-1.5 text-small font-bold text-white [text-shadow:0_1px_0_var(--color-ink)]">
          <span className="size-2 rounded-full bg-green border-[1.5px] border-ink" />
          {jam.friendsLiked} {jam.friendsLiked === 1 ? "friend likes" : "friends like"} this
        </div>
      )}

      {/* right action rail */}
      <div className="absolute right-3.5 bottom-32 z-10">
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

      {/* next jam peeking in from below */}
      {next && (
        <button
          onClick={() => onComments(next)}
          className="absolute left-3.5 right-3.5 bottom-0 z-[5] flex items-center gap-3 bg-green border-[2.5px] border-b-0 border-ink rounded-t-toy-lg px-4 pt-3 pb-5 text-left"
        >
          <EmojiToken emoji={next.iconEmoji} color="cream" size={40} rounded="toy" />
          <span className="flex flex-col">
            <span className="font-extrabold text-body text-ink">
              {next.name}{" "}
              <span className="font-semibold text-green-deep">· @{next.maker.username} ✓</span>
            </span>
            <span className="text-xs font-bold text-green-deep">↑ swipe for the next jam</span>
          </span>
        </button>
      )}

      {picking && (
        <FriendPicker jamSlug={jam.slug} onClose={() => setPicking(false)} />
      )}
    </section>
  );
}
