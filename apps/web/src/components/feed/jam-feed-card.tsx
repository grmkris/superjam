"use client";

// JamFeedCard (DESIGN_BRIEF §3b) — one full-screen feed cell. Two modes:
//   poster   the play surface, maker, remix chip, tagline, ▸ Play now, rail
//   playing  the jam runs LIVE in-feed via %67's <AppHost> (a real app, not a
//            video — the differentiator vs TikTok)
// The ENS name tag lives on the jam PAGE, not the card (design round 6).
import { useState } from "react";
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
  onComments,
  onRemix,
}: {
  jam: FeedJam;
  next: FeedJam | null;
  onComments: (j: FeedJam) => void;
  onRemix: (j: FeedJam) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [liked, setLiked] = useState(false);
  const [picking, setPicking] = useState(false);

  if (playing) {
    return (
      <section className={cx("relative h-full snap-start flex flex-col", ACCENT_BG[jam.accent])}>
        <div className="flex items-center gap-2.5 px-4 pt-14 pb-2">
          <span className="inline-flex items-center gap-2 bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-[13.5px] font-bold">
            <span>{jam.iconEmoji}</span>
            <span>{jam.name}</span>
            <Handle username={jam.maker.username} verified={jam.maker.verified} muted />
          </span>
          <button
            onClick={() => setPlaying(false)}
            aria-label="Close jam"
            className="ml-auto flex items-center justify-center w-[38px] h-[38px] rounded-full bg-card border-2 border-ink text-[15px] font-extrabold sticker-press"
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
        <div className={cx("text-[32px] font-extrabold [text-shadow:0_3px_0_#221A33]", ACCENT_TITLE[jam.accent])}>
          {jam.name}
        </div>
        <span className="inline-flex items-center gap-1.5 bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-[13.5px] font-bold">
          <EmojiToken emoji="🦊" color="green" size={20} />
          <Handle username={jam.maker.username} verified={jam.maker.verified} />
        </span>
        {jam.remixOf && (
          <span className="inline-flex items-center gap-1 bg-card/90 border-2 border-ink rounded-full px-2.5 py-1 text-[10.5px] font-extrabold">
            🔁 remix of {jam.remixOf.name} <span className="text-blue">↗</span>
          </span>
        )}
      </div>

      <div className="max-w-[280px] bg-card/95 border-2 border-ink rounded-2xl shadow-sticker px-4 py-2.5 text-center text-[14.5px] font-semibold leading-snug">
        “{jam.tagline}”
      </div>

      <button
        onClick={() => setPlaying(true)}
        className="inline-flex items-center gap-2 bg-pink text-white border-[2.5px] border-ink rounded-full px-9 py-3.5 text-lg font-extrabold shadow-sticker-lg sticker-press"
      >
        ▸ Play now
      </button>

      {jam.friendsPlayed > 0 && (
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-white [text-shadow:0_1px_0_#221A33]">
          <span className="w-2 h-2 rounded-full bg-green border-[1.5px] border-ink" />
          {jam.friendsPlayed} friends played today
        </div>
      )}

      {/* right action rail */}
      <div className="absolute right-3.5 bottom-32 z-10">
        <FeedActionRail
          likes={jam.likes}
          comments={jam.comments}
          liked={liked}
          onLike={() => setLiked((v) => !v)}
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
            <span className="font-extrabold text-[15px] text-ink">
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
