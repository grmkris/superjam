"use client";

// Jam page (DESIGN_BRIEF §3b-iii) — the jam plus its Reviews (the ✓-human
// feedback surface; comments are folded into reviews backend-side). Full ENS
// name tag (↗ Basescan), remix lineage, built-by row. Reviews are real
// (reviews.list); leaving one is World-gated (reviews.upsert).
import type { AppId } from "@superjam/shared";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NameTag } from "../../../components/name-tag";
import { FriendPicker } from "../../../components/chat/friend-picker";
import { VerifiedBadge } from "../../../components/verified-badge";
import { WorldGate } from "../../../components/world-gate";
import { basescan } from "../../../components/ui/brand";
import { cx } from "../../../components/ui/cx";
import { EmojiToken, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { type FeedJam, loadFeed } from "../../../components/feed/jam";
import { usePlatformClient } from "../../../components/use-platform-client";
import { useHostAuth } from "../../../lib/use-host-auth";

interface Review {
  username: string;
  worldVerified: boolean;
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

export default function JamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const client = usePlatformClient();
  const { hostUser } = useHostAuth();

  const [jam, setJam] = useState<FeedJam | null | "missing">(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [verified, setVerified] = useState(false);
  const [gate, setGate] = useState(false);
  const [draftRating, setDraftRating] = useState(0);
  const [draftText, setDraftText] = useState("");
  const [sendKind, setSendKind] = useState<"share" | "challenge" | null>(null);

  useEffect(() => {
    setVerified(Boolean(hostUser?.worldVerified));
  }, [hostUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let found: FeedJam | null = null;
      try {
        const feed = await loadFeed(client);
        found = feed.find((j) => j.slug === slug) ?? null;
      } catch {
        /* fall through */
      }
      if (!found) {
        try {
          const a = await client.apps.get({ slug });
          found = {
            ...a,
            maker: { username: "maker", verified: false },
            tagline: "",
            accent: "blue",
            likes: 0,
            comments: 0,
            friendsPlayed: 0,
            remixOf: null,
          };
        } catch {
          /* missing */
        }
      }
      if (cancelled) return;
      if (!found) {
        setJam("missing");
        return;
      }
      setJam(found);
      try {
        const r = await client.reviews.list({ appId: found.id as AppId });
        if (!cancelled) setReviews(r.reviews);
      } catch {
        /* no reviews yet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, slug]);

  const submitReview = async () => {
    if (jam === null || jam === "missing" || draftRating === 0) return;
    if (!verified) {
      setGate(true);
      return;
    }
    try {
      await client.reviews.upsert({
        appId: jam.id as AppId,
        rating: draftRating,
        text: draftText.trim() || undefined,
      });
      const r = await client.reviews.list({ appId: jam.id as AppId });
      setReviews(r.reviews);
      setDraftRating(0);
      setDraftText("");
    } catch {
      /* surfaced by the empty state staying put */
    }
  };

  if (jam === null) {
    return <div className="p-6 text-muted font-semibold">loading…</div>;
  }
  if (jam === "missing") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center min-h-full">
        <div className="text-5xl">🧸</div>
        <div className="font-extrabold text-lg">this jam wandered off</div>
        <button onClick={() => router.push("/")} className="font-bold text-pink">
          ‹ back to Discover
        </button>
      </div>
    );
  }

  const avg =
    reviews.length > 0
      ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)
      : null;

  return (
    <div className="flex flex-col gap-3 px-5 pt-14 pb-6 bg-cream min-h-full">
      <div className="flex items-center gap-2.5">
        <button onClick={() => router.push("/")} className="text-[15px] font-bold text-muted">
          ‹ Discover
        </button>
        {avg && (
          <span className="ml-auto text-xs font-bold text-muted">
            ★ {avg} · {reviews.length} humans
          </span>
        )}
      </div>

      {/* jam header */}
      <StickerCard className="p-4 flex items-center gap-3 shadow-sticker-md">
        <EmojiToken emoji={jam.iconEmoji} color="blue" size={56} rounded="toy" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="font-extrabold text-lg truncate">{jam.name}</div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
            by @{jam.maker.username}{" "}
            {jam.maker.verified && <VerifiedBadge variant="pill" />}
          </div>
        </div>
        <button
          onClick={() => router.push(`/app/${jam.slug}`)}
          className="ml-auto bg-pink text-white border-2 border-ink rounded-full px-5 py-2 text-sm font-extrabold shadow-sticker-sm sticker-press"
        >
          Play
        </button>
      </StickerCard>

      {/* chain facts */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {jam.ensName && <NameTag name={jam.ensName} href={basescan(jam.ensName)} />}
        {jam.remixOf && (
          <span className="bg-card border-2 border-ink rounded-full px-2.5 py-1 text-[10.5px] font-extrabold">
            🔁 remix of {jam.remixOf.name} <span className="text-blue">↗</span>
          </span>
        )}
      </div>

      {/* send / challenge a friend */}
      <div className="flex gap-2">
        <StickerButton color="white" size="sm" onClick={() => setSendKind("share")}>
          📣 Send to a friend
        </StickerButton>
        <StickerButton color="pink" size="sm" onClick={() => setSendKind("challenge")}>
          ⚔ Challenge
        </StickerButton>
      </div>

      <div className="flex bg-card border-2 border-ink rounded-full p-1">
        <div className="flex-1 rounded-full py-2 text-center text-[13.5px] font-extrabold bg-ink text-cream">
          ★ Reviews · {reviews.length}
        </div>
      </div>

      {/* review rows */}
      {reviews.length === 0 ? (
        <div className="text-center text-muted font-semibold py-6">
          no reviews yet — be the first ✓
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {reviews.map((r, i) => (
            <ReviewCard key={i} r={r} tilt={i % 2 === 0 ? -0.4 : 0.4} />
          ))}
        </div>
      )}

      {/* composer (World-gated) */}
      {gate ? (
        <WorldGate
          title="Verify to leave a review"
          blurb="reviews are humans only — no bot ratings."
          onVerified={() => {
            setVerified(true);
            setGate(false);
            client.profile.me().then(() => {}).catch(() => {});
          }}
        />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setDraftRating(n)}
                className={cx(
                  "text-2xl leading-none",
                  n <= draftRating ? "opacity-100" : "opacity-30"
                )}
                aria-label={`${n} stars`}
              >
                ★
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              maxLength={280}
              placeholder="say something…"
              className="flex-1 bg-card border-2 border-ink rounded-full px-4 py-3 text-[13.5px] font-semibold placeholder:text-muted outline-none focus:border-pink"
            />
            <StickerButton
              color="yellow"
              size="md"
              onClick={submitReview}
              disabled={draftRating === 0}
            >
              ↑
            </StickerButton>
          </div>
          {verified ? (
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-muted">
              <VerifiedBadge />
              prove you're human once with World ID — no bots in here
            </div>
          ) : (
            <button
              onClick={() => setGate(true)}
              className="flex items-center justify-center gap-1.5 text-xs font-extrabold text-blue sticker-press"
            >
              <VerifiedBadge />
              Verify with World ID to review →
            </button>
          )}
        </div>
      )}

      {sendKind && (
        <FriendPicker
          jamSlug={jam.slug}
          challenge={sendKind === "challenge"}
          onClose={() => setSendKind(null)}
        />
      )}
    </div>
  );
}

function ReviewCard({ r, tilt }: { r: Review; tilt: number }) {
  return (
    <StickerCard color="white" className="p-3.5 flex flex-col gap-1.5" tilt={tilt}>
      <div className="flex items-center gap-2">
        <EmojiToken emoji="🙂" color="green" size={30} />
        <span className="font-extrabold text-sm">@{r.username}</span>
        {r.worldVerified && <VerifiedBadge variant="pill" />}
        <span className="ml-auto text-[11.5px] font-semibold text-muted">
          {ago(r.createdAt)}
        </span>
      </div>
      <div className="text-amber-ink text-sm font-extrabold tracking-wide">
        {"★".repeat(r.rating)}
        <span className="text-muted/40">{"★".repeat(5 - r.rating)}</span>
      </div>
      {r.text && (
        <div className="text-[13.5px] font-semibold leading-snug">{r.text}</div>
      )}
    </StickerCard>
  );
}
