"use client";

// FeedActionRail (DESIGN_BRIEF §3b) — the right-side rail on every feed card:
// like, comments → jam page, share, remix. Big tap targets, white sticker
// circles, labels in white that survive a colorful background.
import { cx } from "../ui/cx";
import { compactCount } from "./jam";

function RailButton({
  emoji,
  label,
  onClick,
  active,
}: {
  emoji: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="focus-ring flex flex-col items-center gap-1 bg-transparent border-0 p-0"
    >
      <span
        className={cx(
          "flex items-center justify-center size-[50px] rounded-full border-2 border-ink shadow-sticker sticker-press text-[22px]",
          active ? "bg-pink" : "bg-card"
        )}
      >
        {emoji}
      </span>
      <span className="text-tiny font-extrabold text-white [text-shadow:0_1px_0_var(--color-ink)]">
        {label}
      </span>
    </button>
  );
}

export function FeedActionRail({
  likes,
  comments,
  liked,
  onLike,
  onComments,
  onShare,
  onRemix,
}: {
  likes: number;
  comments: number;
  liked: boolean;
  onLike: () => void;
  onComments: () => void;
  onShare: () => void;
  onRemix: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3.5">
      <RailButton
        emoji="❤️"
        label={compactCount(likes)}
        active={liked}
        onClick={onLike}
      />
      <RailButton emoji="💬" label={compactCount(comments)} onClick={onComments} />
      <RailButton emoji="📣" label="share" onClick={onShare} />
      <RailButton emoji="🔁" label="remix" onClick={onRemix} />
    </div>
  );
}
