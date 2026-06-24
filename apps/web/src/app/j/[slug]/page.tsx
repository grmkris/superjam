"use client";

// Jam page (DESIGN_BRIEF §3b-iii) — the jam plus its Reviews (the feedback
// surface; comments are folded into reviews backend-side). Remix lineage,
// built-by row. The reviews surface itself is the shared <JamReviews>.
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FriendPicker } from "../../../components/chat/friend-picker";
import { EmojiToken, Pill, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import { type FeedJam, loadFeed } from "../../../components/feed/jam";
import { JamReviews } from "../../../components/jam-reviews";
import { usePlatformClient } from "../../../components/use-platform-client";

export default function JamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const client = usePlatformClient();

  const [jam, setJam] = useState<FeedJam | null | "missing">(null);
  const [sendKind, setSendKind] = useState<"share" | "challenge" | null>(null);

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
            likes: a.likes,
            likedByMe: a.likedByMe,
            comments: 0,
            friendsLiked: 0,
            remixOf: null,
          };
        } catch {
          /* missing */
        }
      }
      if (cancelled) return;
      setJam(found ?? "missing");
    })();
    return () => {
      cancelled = true;
    };
  }, [client, slug]);

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

  return (
    <div className="screen gap-3">
      <div className="flex items-center gap-2.5">
        <button onClick={() => router.push("/")} className="focus-ring text-body font-bold text-muted">
          ‹ Discover
        </button>
      </div>

      {/* jam header */}
      <StickerCard className="p-4 flex items-center gap-3 shadow-sticker-md">
        <EmojiToken emoji={jam.iconEmoji} color="blue" size={56} rounded="toy" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="font-extrabold text-h3 truncate">{jam.name}</div>
          <div className="flex items-center gap-1.5 text-small font-semibold text-muted">
            by{" "}
            {jam.maker.username === "maker" ? (
              <span>@{jam.maker.username}</span>
            ) : (
              <Link href={`/u/${jam.maker.username}`} className="focus-ring font-bold hover:text-ink">
                @{jam.maker.username}
              </Link>
            )}
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

      {/* remix lineage */}
      {jam.remixOf && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Pill className="text-tiny">
            🔁 remix of {jam.remixOf.name} <span className="text-blue">↗</span>
          </Pill>
        </div>
      )}

      {/* send / challenge a friend */}
      <div className="flex gap-2">
        <StickerButton color="white" size="sm" onClick={() => setSendKind("share")}>
          📣 Send to a friend
        </StickerButton>
        <StickerButton color="pink" size="sm" onClick={() => setSendKind("challenge")}>
          ⚔ Challenge
        </StickerButton>
      </div>

      {/* reviews (shared with the in-feed comments popup) */}
      <JamReviews appId={jam.id} />

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
