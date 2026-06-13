"use client";

// Jam page (DESIGN_BRIEF §3b-iii) — the jam plus Comments · Reviews tabs, the
// full ENS name tag (↗ Basescan), remix lineage, and the "built by" row. The
// ✓-human story rides every row (World ID). Reached via 💬 or tapping a card.
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NameTag } from "../../../components/name-tag";
import { VerifiedBadge } from "../../../components/verified-badge";
import { basescan } from "../../../components/ui/brand";
import { cx } from "../../../components/ui/cx";
import { EmojiToken, StickerCard } from "../../../components/ui/sticker";
import { type FeedJam, loadFeed } from "../../../components/feed/jam";

interface Comment {
  emoji: string;
  color: "green" | "blue" | "yellow" | "pink";
  username: string;
  human: boolean;
  maker?: boolean;
  ago: string;
  text: string;
  likes?: number;
  score?: string;
}

// TODO(seam %67): replace with reviews.list / comments.list once on the router.
const COMMENTS: Comment[] = [
  { emoji: "🐸", color: "green", username: "nika", human: true, ago: "2m", text: "lost twice, blamed the questions. who's got a 5/5??", likes: 12 },
  { emoji: "🐻", color: "blue", username: "theo", human: true, ago: "1h", text: "too hard and I'm too proud to google", score: "scored 4/5" },
  { emoji: "🦊", color: "yellow", username: "mira", human: true, maker: true, ago: "3h", text: "new questions every friday 😈" },
];

export default function JamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const [jam, setJam] = useState<FeedJam | null | "missing">(null);
  const [tab, setTab] = useState<"comments" | "reviews">("comments");

  useEffect(() => {
    loadFeed().then((js) => setJam(js.find((j) => j.slug === slug) ?? "missing"));
  }, [slug]);

  if (jam === null) {
    return <div className="p-6 text-muted font-semibold">loading…</div>;
  }
  if (jam === "missing") {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-5xl">🧸</div>
        <div className="font-extrabold text-lg">this jam wandered off</div>
        <button onClick={() => router.push("/")} className="font-bold text-pink">
          ‹ back to Discover
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-5 pt-14 pb-6 bg-cream min-h-full">
      <div className="flex items-center gap-2.5">
        <button onClick={() => router.push("/")} className="text-[15px] font-bold text-muted">
          ‹ Discover
        </button>
        <span className="ml-auto text-xs font-bold text-muted">★ 4.8 · 31 humans</span>
      </div>

      {/* jam header */}
      <StickerCard className="p-4 flex items-center gap-3 shadow-sticker-md">
        <EmojiToken emoji={jam.iconEmoji} color="blue" size={56} rounded="toy" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="font-extrabold text-lg truncate">{jam.name}</div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
            by @{jam.maker.username} {jam.maker.verified && <VerifiedBadge variant="pill" />}
          </div>
        </div>
        <button
          onClick={() => router.push(`/app/${jam.slug}`)}
          className="ml-auto bg-pink text-white border-2 border-ink rounded-full px-5 py-2 text-sm font-extrabold shadow-sticker-sm sticker-press"
        >
          Play
        </button>
      </StickerCard>

      {/* chain facts: name tag + remix + built-by */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {jam.ensName && <NameTag name={jam.ensName} href={basescan(jam.ensName)} />}
        {jam.remixOf && (
          <span className="bg-card border-2 border-ink rounded-full px-2.5 py-1 text-[10.5px] font-extrabold">
            🔁 remix of {jam.remixOf.name} <span className="text-blue">↗</span>
          </span>
        )}
        <span className="bg-card border-2 border-ink rounded-full px-2.5 py-1 text-[10.5px] font-extrabold">
          🛠️ built by <span className="underline">the maker</span> ·{" "}
          <span className="text-amber-ink">★ 4.9</span>
        </span>
      </div>

      {/* tabs */}
      <div className="flex bg-card border-2 border-ink rounded-full p-1 gap-1">
        {(["comments", "reviews"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "flex-1 rounded-full py-2 text-[13.5px] capitalize",
              tab === t ? "bg-ink text-cream font-extrabold" : "text-muted font-semibold"
            )}
          >
            {t === "comments" ? `💬 Comments · ${jam.comments}` : "★ Reviews · 31"}
          </button>
        ))}
      </div>

      {/* rows */}
      <div className="flex flex-col gap-2.5">
        {COMMENTS.map((c, i) => (
          <CommentCard key={i} c={c} tilt={i === 0 ? -0.4 : i === 1 ? 0.4 : 0} />
        ))}
      </div>

      {/* composer + world gate */}
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="flex-1 bg-card border-2 border-ink rounded-full px-4 py-3 text-[13.5px] font-semibold text-muted">
            say something…
          </div>
          <button className="w-12 h-12 bg-yellow border-2 border-ink rounded-full text-lg font-extrabold shadow-sticker-sm sticker-press">
            ↑
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-muted">
          <VerifiedBadge />
          prove you're human once with World ID — no bots in here
        </div>
      </div>
    </div>
  );
}

function CommentCard({ c, tilt }: { c: Comment; tilt: number }) {
  return (
    <StickerCard color="white" className={cx("p-3.5 flex flex-col gap-1.5", c.maker && "opacity-80")} tilt={tilt}>
      <div className="flex items-center gap-2">
        <EmojiToken emoji={c.emoji} color={c.color} size={30} />
        <span className="font-extrabold text-sm">@{c.username}</span>
        {c.maker ? (
          <span className="bg-yellow border-[1.5px] border-ink rounded-full px-2 py-0.5 text-[10px] font-extrabold">
            maker
          </span>
        ) : (
          c.human && <VerifiedBadge variant="pill" />
        )}
        <span className="ml-auto text-[11.5px] font-semibold text-muted">{c.ago}</span>
      </div>
      <div className="text-[13.5px] font-semibold leading-snug">{c.text}</div>
      {c.likes != null && (
        <div className="flex gap-2.5 text-[11.5px] font-bold text-muted">
          <span>❤️ {c.likes}</span>
          <span>↩ reply</span>
        </div>
      )}
      {c.score && (
        <span className="self-start flex items-center gap-1.5 bg-cream border-[1.5px] border-ink rounded-full px-2.5 py-0.5 text-[11px] font-extrabold">
          🏆 {c.score}
        </span>
      )}
    </StickerCard>
  );
}
