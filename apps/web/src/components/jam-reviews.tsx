"use client";

// JamReviews — the shared reviews/feedback surface for a jam (comments are folded
// into reviews backend-side). Used both by the full jam page (/j/[slug]) and by
// the in-feed comments popup (CommentsSheet). Self-contained: fetches its own
// list and posts via reviews.list / reviews.upsert for the given appId.
import type { AppId } from "@superjam/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { avatarEmoji } from "./ui/identity";
import { cx } from "./ui/cx";
import { Input } from "./ui/field";
import { MicButton } from "./ui/mic-button";
import { EmojiToken, StickerButton } from "./ui/sticker";
import { usePlatformClient } from "./use-platform-client";

interface Review {
  username: string;
  rating: number;
  text: string | null;
  createdAt: string | number | Date;
}

function ago(d: string | number | Date): string {
  const t = new Date(d).getTime();
  const s = (Date.now() - t) / 1000;
  if (Number.isNaN(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function JamReviews({ appId }: { appId: string }) {
  const client = usePlatformClient();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [draftRating, setDraftRating] = useState(0);
  const [draftText, setDraftText] = useState("");

  useEffect(() => {
    let cancelled = false;
    client.reviews
      .list({ appId: appId as AppId })
      .then((r) => {
        if (!cancelled) setReviews(r.reviews);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, appId]);

  const submitReview = async () => {
    if (draftRating === 0) return;
    try {
      await client.reviews.upsert({
        appId: appId as AppId,
        rating: draftRating,
        text: draftText.trim() || undefined,
      });
      const r = await client.reviews.list({ appId: appId as AppId });
      setReviews(r.reviews);
      setDraftRating(0);
      setDraftText("");
    } catch {
      /* surfaced by the list staying put */
    }
  };

  const list = reviews ?? [];
  const avg =
    list.length > 0
      ? (list.reduce((a, r) => a + r.rating, 0) / list.length).toFixed(1)
      : null;

  return (
    <div className="flex flex-col gap-3">
      {/* count / average header */}
      <div className="flex bg-card border border-line rounded-full p-1">
        <div className="flex-1 rounded-full py-2 text-center text-small font-extrabold bg-ink text-cream tabular-nums">
          ★ {avg ? `${avg} · ` : ""}
          {list.length} {list.length === 1 ? "review" : "reviews"}
        </div>
      </div>

      {/* review rows */}
      {reviews === null ? (
        <div className="text-center text-muted font-semibold py-6">loading…</div>
      ) : list.length === 0 ? (
        <div className="text-center text-muted font-semibold py-6">
          no reviews yet — be the first ✓
        </div>
      ) : (
        <div className="flex flex-col gap-4 stagger">
          {list.map((r, i) => (
            <ReviewCard key={i} r={r} />
          ))}
        </div>
      )}

      {/* composer */}
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setDraftRating(n)}
              className={cx(
                "focus-ring text-2xl leading-none",
                n <= draftRating ? "opacity-100" : "opacity-30"
              )}
              aria-label={`${n} stars`}
            >
              ★
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            maxLength={280}
            placeholder="say something…"
            className="flex-1 rounded-full text-small"
          />
          <MicButton value={draftText} onChange={(t) => setDraftText(t.slice(0, 280))} />
          <StickerButton
            size="md"
            onClick={submitReview}
            disabled={draftRating === 0}
          >
            ↑
          </StickerButton>
        </div>
      </div>
    </div>
  );
}

// One review — identity row, a speech-bubble for the text (the rounded-tl-md
// corner is the little tail pointing back at the avatar), then the rating chip
// underneath. Rating-only reviews skip the bubble.
function ReviewCard({ r }: { r: Review }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Link
          href={`/u/${r.username}`}
          className="focus-ring flex items-center gap-2 sticker-press"
        >
          <EmojiToken emoji={avatarEmoji(r.username)} color="green" size={30} />
          <span className="font-extrabold text-small">@{r.username}</span>
        </Link>
        <span className="ml-auto text-tiny font-semibold text-muted">{ago(r.createdAt)}</span>
      </div>
      {r.text && (
        <div className="ml-[38px] bg-card border border-line rounded-toy rounded-tl-md shadow-sticker-sm px-3.5 py-2 text-small prose-body">
          {r.text}
        </div>
      )}
      <div className="ml-[38px] text-amber-ink text-small font-extrabold tracking-wide">
        {"★".repeat(r.rating)}
        <span className="text-muted/40">{"★".repeat(5 - r.rating)}</span>
      </div>
    </div>
  );
}
