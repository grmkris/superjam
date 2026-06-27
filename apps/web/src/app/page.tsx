"use client";

// Discover — the default landing (DESIGN_BRIEF §3b). A TikTok-style vertical
// feed of jams: one fills the screen, the next peeks from below, swipe up for
// more. The differentiator vs TikTok: tap Play and the jam runs LIVE in the
// feed (real app, not a video). Tab pills For you · Friends · New float on top.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { JamFeedCard } from "../components/feed/jam-feed-card";
import { type FeedJam, type FeedTab, loadFeed } from "../components/feed/jam";
import { Skeleton } from "../components/ui/skeleton";
import { SparkMark } from "../components/ui/nav-icons";
import { StickerButton } from "../components/ui/sticker";
import { usePlatformClient } from "../components/use-platform-client";

export default function DiscoverPage() {
  const router = useRouter();
  const client = usePlatformClient();
  // Feed source. The For you / Friends / New switcher is deferred to a later
  // stage — for now the feed always loads "For you".
  const [tab] = useState<FeedTab>("foryou");
  const [jams, setJams] = useState<FeedJam[] | null>(null);
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
    <div className="relative flex h-full flex-col bg-ink">
      {/* The unified top bar now lives inside each jam's JamChrome (identity +
          actions + profile), so the feed is edge-to-edge with no page-level band. */}
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  // A calm, monochrome loading state on a light surface (the SparkMark anchors it).
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-6 bg-paper">
      <span className="inline-flex size-20 items-center justify-center rounded-toy-lg border border-line bg-card shadow-sticker">
        <SparkMark width={36} height={36} aria-hidden />
      </span>
      <Skeleton className="w-40 h-7 rounded-full" />
      <Skeleton className="w-64 h-12 rounded-toy" />
      <Skeleton className="w-36 h-12 rounded-full" />
    </div>
  );
}

function EmptyFeed({ onMake }: { onMake: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center bg-paper">
      <span className="inline-flex size-20 items-center justify-center rounded-toy-lg border border-line bg-card shadow-sticker">
        <SparkMark width={40} height={40} aria-hidden />
      </span>
      <div className="text-h2 font-extrabold tracking-display text-ink">
        Nothing here yet
      </div>
      <div className="text-muted font-semibold">Be the first to make one.</div>
      <StickerButton size="lg" onClick={onMake}>
        Make a jam
      </StickerButton>
    </div>
  );
}
