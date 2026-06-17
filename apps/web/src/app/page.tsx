"use client";

// Discover — the default landing (DESIGN_BRIEF §3b). A TikTok-style vertical
// feed of jams: one fills the screen, the next peeks from below, swipe up for
// more. The differentiator vs TikTok: tap Play and the jam runs LIVE in the
// feed (real app, not a video). Tab pills For you · Friends · New float on top.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JamFeedCard } from "../components/feed/jam-feed-card";
import { type FeedJam, type FeedTab, loadFeed } from "../components/feed/jam";
import { cx } from "../components/ui/cx";
import { Skeleton } from "../components/ui/skeleton";
import { StickerButton } from "../components/ui/sticker";
import { usePlatformClient } from "../components/use-platform-client";

const TABS: { key: FeedTab; label: string }[] = [
  { key: "foryou", label: "For you" },
  { key: "friends", label: "Friends" },
  { key: "new", label: "New" },
];

export default function DiscoverPage() {
  const router = useRouter();
  const client = usePlatformClient();
  const [tab, setTab] = useState<FeedTab>("foryou");
  const [jams, setJams] = useState<FeedJam[] | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setJams(null);
    loadFeed(client, tab).then((j) => {
      if (!cancelled) setJams(j);
    });
    return () => {
      cancelled = true;
    };
  }, [client, tab]);

  return (
    <div className="relative h-full bg-blue">
      {/* tab pills — hidden while a jam plays so they don't overlap its header */}
      {!playing && (
        <div className="absolute top-5 left-0 right-0 z-20 flex gap-2 px-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cx(
                "focus-ring flex-1 text-center border-2 border-ink rounded-full px-4 py-1.5 text-small",
                tab === t.key
                  ? "bg-ink text-cream font-bold"
                  : "bg-white/85 text-ink font-semibold"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {jams === null ? (
        <FeedSkeleton />
      ) : jams.length === 0 ? (
        <EmptyFeed onMake={() => router.push("/build")} />
      ) : (
        // mobile: hard full-screen snap scroll; desktop (lg): smooth free
        // scroll in the same single centered column — no snap.
        <div className="h-full overflow-y-auto snap-y snap-mandatory lg:snap-none lg:scroll-smooth">
          {jams.map((jam, i) => (
            <JamFeedCard
              key={jam.id}
              jam={jam}
              next={jams[i + 1] ?? null}
              onPlayingChange={setPlaying}
              onComments={(j) => router.push(`/j/${j.slug}`)}
              onRemix={(j) => router.push(`/build?remix=${j.slug}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedSkeleton() {
  // Toybox Skeleton, restyled white-translucent to read on the blue bleed.
  const wash = "bg-white/30 border-2 border-ink/40";
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
      <Skeleton className={cx("size-[140px] rounded-toy-lg", wash)} />
      <Skeleton className={cx("w-40 h-7 rounded-full", wash)} />
      <Skeleton className={cx("w-64 h-12 rounded-toy", wash)} />
      <Skeleton className={cx("w-36 h-12 rounded-full", wash)} />
    </div>
  );
}

function EmptyFeed({ onMake }: { onMake: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="text-6xl">🧸</div>
      <div className="text-h2 font-extrabold text-white ink-drop">
        nothing here yet
      </div>
      <div className="text-white/90 font-semibold">make the first jam ✨</div>
      <StickerButton
        color="pink"
        size="lg"
        onClick={onMake}
        className="rounded-full px-8 shadow-sticker-lg"
      >
        ⚡ Make a jam
      </StickerButton>
    </div>
  );
}
