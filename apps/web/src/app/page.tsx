"use client";

// Discover — the default landing (DESIGN_BRIEF §3b). A TikTok-style vertical
// feed of jams: one fills the screen, the next peeks from below, swipe up for
// more. The differentiator vs TikTok: tap Play and the jam runs LIVE in the
// feed (real app, not a video). Tab pills For you · Friends · New float on top.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const [fullscreen, setFullscreen] = useState(false);
  // The jam snapped into view — only it plays live, and the URL reflects it.
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

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

  // Mark the ≥60%-visible cell active (it plays; others are cheap posters).
  useEffect(() => {
    const root = feedRef.current;
    if (!root || !jams || jams.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            setActiveSlug((e.target as HTMLElement).dataset.slug ?? null);
          }
        }
      },
      { root, threshold: [0.6] }
    );
    root.querySelectorAll<HTMLElement>("[data-slug]").forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [jams]);

  // Reflect the open jam in the URL (shallow — keeps the feed mounted + scrolled).
  useEffect(() => {
    if (activeSlug) window.history.replaceState(null, "", `/?j=${activeSlug}`);
  }, [activeSlug]);

  // Deep-link in: on first load, scroll to ?j=<slug> if present.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !jams || jams.length === 0) return;
    deepLinked.current = true;
    const want = new URLSearchParams(window.location.search).get("j");
    if (want) {
      feedRef.current
        ?.querySelector<HTMLElement>(`[data-slug="${CSS.escape(want)}"]`)
        ?.scrollIntoView();
    }
  }, [jams]);

  // Preload window: the active cell ± 1 mount live (neighbours load off-screen so
  // there's no spinner on swipe). Default to the first jam before the observer fires.
  const mountWindow = new Set<string>();
  if (jams && jams.length > 0) {
    const ai = jams.findIndex((j) => j.slug === activeSlug);
    const center = ai >= 0 ? ai : 0;
    for (const k of [center - 1, center, center + 1]) {
      const j = jams[k];
      if (j) mountWindow.add(j.slug);
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-blue">
      {/* Tier 1 — feed switcher as a centered segmented pill ABOVE the scroll, so
          the active jam's top bar (and the app below it) never collide with it.
          The profile avatar (TopBar overlay) keeps the top-right. */}
      {!fullscreen && (
        <div className="z-20 flex shrink-0 justify-center px-4 pt-4 pb-2">
          <div
            role="tablist"
            aria-label="Feed"
            className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-white/85 p-1 shadow-sticker-sm backdrop-blur"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cx(
                  "focus-ring rounded-full px-4 py-1.5 text-small transition-colors",
                  tab === t.key ? "bg-ink text-cream font-bold" : "text-ink font-semibold"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {jams === null ? (
          <FeedSkeleton />
        ) : jams.length === 0 ? (
          <EmptyFeed onMake={() => router.push("/build")} />
        ) : (
          // Vertical snap feed — one jam locks in; only active ± 1 mount live.
          <div ref={feedRef} className="h-full overflow-y-auto snap-y snap-mandatory snap-always">
            {jams.map((jam) => (
              <JamFeedCard
                key={jam.id}
                jam={jam}
                active={jam.slug === activeSlug}
                mounted={mountWindow.has(jam.slug)}
                onFullscreenChange={setFullscreen}
                onComments={(j) => router.push(`/j/${j.slug}`)}
              />
            ))}
          </div>
        )}
      </div>
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
