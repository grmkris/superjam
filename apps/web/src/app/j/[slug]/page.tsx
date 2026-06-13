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
import { ensApp } from "../../../components/ui/brand";
import { cx } from "../../../components/ui/cx";
import { EmojiToken, Pill, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { Input } from "../../../components/ui/field";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
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
    return (
      <div className="screen gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (jam === "missing") {
    return (
      <div className="screen items-center justify-center">
        <EmptyState
          emoji="🧸"
          title="this jam wandered off"
          action={
            <StickerButton color="white" size="sm" onClick={() => router.push("/")}>
              ‹ back to Discover
            </StickerButton>
          }
        />
      </div>
    );
  }

  const avg =
    reviews.length > 0
      ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)
      : null;

  return (
    <div className="screen gap-3">
      <div className="flex items-center gap-2.5">
        <button onClick={() => router.push("/")} className="focus-ring text-body font-bold text-muted">
          ‹ Discover
        </button>
        {avg && (
          <span className="ml-auto text-tiny font-bold text-muted">
            ★ {avg} · {reviews.length} humans
          </span>
        )}
      </div>

      {/* jam header */}
      <StickerCard className="p-4 flex items-center gap-3 shadow-sticker-md">
        <EmojiToken emoji={jam.iconEmoji} color="blue" size={56} rounded="toy" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="font-extrabold text-h3 truncate">{jam.name}</div>
          <div className="flex items-center gap-1.5 text-small font-semibold text-muted">
            by @{jam.maker.username}{" "}
            {jam.maker.verified && <VerifiedBadge variant="pill" />}
          </div>
        </div>
        <StickerButton
          color="pink"
          size="sm"
          onClick={() => router.push(`/app/${jam.slug}`)}
          className="ml-auto rounded-full px-5"
        >
          Play
        </StickerButton>
      </StickerCard>

      {/* chain facts */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {jam.ensName && <NameTag name={jam.ensName} href={ensApp(jam.ensName)} />}
        {jam.remixOf && (
          <Pill className="text-tiny">
            🔁 remix of {jam.remixOf.name} <span className="text-blue">↗</span>
          </Pill>
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
        <div className="flex-1 rounded-full py-2 text-center text-small font-extrabold bg-ink text-cream">
          ★ Reviews · {reviews.length}
        </div>
      </div>

      {/* review rows */}
      {reviews.length === 0 ? (
        <div className="text-center text-muted font-semibold py-6">
          no reviews yet — be the first ✓
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 stagger">
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
            <div className="flex items-center justify-center gap-1.5 text-tiny font-bold text-muted">
              <VerifiedBadge />
              prove you're human once with World ID — no bots in here
            </div>
          ) : (
            <button
              onClick={() => setGate(true)}
              className="focus-ring flex items-center justify-center gap-1.5 text-tiny font-extrabold text-blue sticker-press"
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
        <span className="font-extrabold text-small">@{r.username}</span>
        {r.worldVerified && <VerifiedBadge variant="pill" />}
        <span className="ml-auto text-tiny font-semibold text-muted">
          {ago(r.createdAt)}
        </span>
      </div>
      <div className="text-amber-ink text-small font-extrabold tracking-wide">
        {"★".repeat(r.rating)}
        <span className="text-muted/40">{"★".repeat(5 - r.rating)}</span>
      </div>
      {r.text && (
        <div className="text-small font-semibold leading-snug">{r.text}</div>
      )}
    </StickerCard>
  );
}
