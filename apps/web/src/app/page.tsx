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

const TABS: { key: FeedTab; label: string }[] = [
  { key: "foryou", label: "For you" },
  { key: "friends", label: "Friends" },
  { key: "new", label: "New" },
];

async function shareJam(j: FeedJam) {
  const url = `${window.location.origin}/app/${j.slug}`;
  try {
    if (navigator.share) await navigator.share({ title: j.name, url });
    else await navigator.clipboard.writeText(url);
  } catch {
    /* user dismissed */
  }
}

export default function DiscoverPage() {
  const router = useRouter();
  const [tab, setTab] = useState<FeedTab>("foryou");
  const [jams, setJams] = useState<FeedJam[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setJams(null);
    loadFeed(tab).then((j) => {
      if (!cancelled) setJams(j);
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div className="relative h-full bg-blue">
      {/* tab pills */}
      <div className="absolute top-14 left-0 right-0 z-20 flex justify-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "border-2 border-ink rounded-full px-4 py-1.5 text-[13.5px]",
              tab === t.key
                ? "bg-ink text-cream font-bold"
                : "bg-white/85 text-ink font-semibold"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {jams === null ? (
        <FeedSkeleton />
      ) : jams.length === 0 ? (
        <EmptyFeed onMake={() => router.push("/build")} />
      ) : (
        <div className="h-full overflow-y-auto snap-y snap-mandatory">
          {jams.map((jam, i) => (
            <JamFeedCard
              key={jam.id}
              jam={jam}
              next={jams[i + 1] ?? null}
              onComments={(j) => router.push(`/j/${j.slug}`)}
              onShare={shareJam}
              onRemix={(j) => router.push(`/build?remix=${j.slug}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
      <div className="w-[140px] h-[140px] rounded-toy-lg bg-white/30 border-2 border-ink/40 animate-pulse" />
      <div className="w-40 h-7 rounded-full bg-white/30 border-2 border-ink/40 animate-pulse" />
      <div className="w-64 h-12 rounded-2xl bg-white/30 border-2 border-ink/40 animate-pulse" />
      <div className="w-36 h-12 rounded-full bg-white/30 border-2 border-ink/40 animate-pulse" />
    </div>
  );
}

function EmptyFeed({ onMake }: { onMake: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="text-6xl">🧸</div>
      <div className="text-2xl font-extrabold text-white [text-shadow:0_3px_0_#221A33]">
        nothing here yet
      </div>
      <div className="text-white/90 font-semibold">make the first jam ✨</div>
      <button
        onClick={onMake}
        className="inline-flex items-center gap-2 bg-pink text-white border-[2.5px] border-ink rounded-full px-8 py-3.5 text-lg font-extrabold shadow-sticker-lg sticker-press"
      >
        ⚡ Make a jam
      </button>
    </div>
  );
}
