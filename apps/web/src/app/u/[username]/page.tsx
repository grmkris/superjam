"use client";

// Public profile (DESIGN_BRIEF §3f) — `/u/<username>`, reached by tapping any
// @handle (reviews, maker pill, inbox, …). A toybox hero (accent band + overlapping
// avatar), a stats shelf, the three social actions (friend/unfriend · 💸 send ·
// 🙏 ask — ask is friends-only), and the jams this human has shipped. Your own
// handle bounces to /me.
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConfirm } from "../../../components/confirm/confirm-provider";
import { PayFriendSheet } from "../../../components/chat/pay-friend-sheet";
import { cx } from "../../../components/ui/cx";
import {
  EmojiToken,
  Pill,
  StickerButton,
  StickerCard,
} from "../../../components/ui/sticker";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import { useLogin } from "../../../components/login";
import { usePlatformClient } from "../../../components/use-platform-client";
import { useHostAuth } from "../../../lib/use-host-auth";

interface Profile {
  id: string;
  username: string;
  walletAddress: string | null;
  createdAt: string | number | Date;
  isMe: boolean;
  isFriend: boolean;
  friendsCount: number;
}

interface Jam {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
  likes: number;
  plays: number;
  reviewCount: number;
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

// A deterministic accent per handle so every profile owns a colour (mirrors the
// feed's per-jam accents). Stable across renders, no storage needed.
const ACCENTS = ["pink", "yellow", "green", "blue"] as const;
const ACCENT_BG: Record<(typeof ACCENTS)[number], string> = {
  pink: "bg-pink",
  yellow: "bg-yellow",
  green: "bg-green",
  blue: "bg-blue",
};
const accentFor = (s: string): (typeof ACCENTS)[number] =>
  ACCENTS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % ACCENTS.length]!;

const joinedLabel = (d: string | number | Date): string => {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);
  const router = useRouter();
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const { openLogin } = useLogin();
  const { confirm } = useConfirm();

  const [profile, setProfile] = useState<Profile | null | "missing">(null);
  const [jams, setJams] = useState<Jam[] | null>(null);
  const [isFriend, setIsFriend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "pay" | "request">(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.profile
      .get({ username })
      .then((p) => {
        if (cancelled) return;
        if (p.isMe) {
          router.replace("/me");
          return;
        }
        setProfile(p as Profile);
        setIsFriend(p.isFriend);
      })
      .catch(() => {
        if (!cancelled) setProfile("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [client, username, router]);

  useEffect(() => {
    let cancelled = false;
    client.apps
      .byUser({ username })
      .then((r) => {
        if (!cancelled) setJams(r.jams as Jam[]);
      })
      .catch(() => {
        if (!cancelled) setJams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, username]);

  const toggleFriend = async () => {
    if (!isLoggedIn) {
      openLogin();
      return;
    }
    setBusy(true);
    const next = !isFriend;
    setIsFriend(next); // optimistic
    try {
      if (next) await client.friends.add({ username });
      else await client.friends.remove({ username });
    } catch {
      setIsFriend(!next); // revert
    } finally {
      setBusy(false);
    }
  };

  const pay = async (amountUsdc: number, note: string) => {
    setSheet(null);
    if (profile === null || profile === "missing") return;
    // The chat money-line is recorded server-side via payments.recordTip after
    // the public-rail send (the confirm flow handles the actual transfer).
    await confirm({
      kind: "payFriend",
      to: `@${profile.username}`,
      toName: `@${profile.username}`,
      amountUsdc,
      memo: note || undefined,
    }).catch(() => ({ approved: false }));
  };

  const ask = async (amountUsdc: number, note: string) => {
    setSheet(null);
    try {
      await client.chat.requestMoney({
        to: username,
        amountUsdc: String(amountUsdc),
        note: note || undefined,
      });
      setAsked(true);
    } catch {
      /* surfaced by the request not appearing in their thread */
    }
  };

  if (profile === null) {
    return (
      <div className="screen gap-3">
        <Skeleton className="h-36 rounded-toy-lg" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-12" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (profile === "missing") {
    return (
      <div className="screen items-center justify-center">
        <EmptyState
          emoji="🧸"
          title="we couldn't find that human"
          action={
            <StickerButton color="white" size="sm" onClick={() => router.push("/")}>
              ‹ back to Discover
            </StickerButton>
          }
        >
          @{username} isn't on SuperJam
        </EmptyState>
      </div>
    );
  }

  const accent = accentFor(profile.username);
  const payGate = () => (isLoggedIn ? setSheet("pay") : openLogin());
  const askGate = () => (isLoggedIn ? setSheet("request") : openLogin());

  return (
    <div className="screen gap-3">
      <button
        onClick={() => router.back()}
        className="focus-ring self-start text-body font-bold text-muted"
      >
        ‹ Back
      </button>

      {/* hero — accent band + overlapping avatar */}
      <StickerCard color="white" className="relative overflow-hidden p-0 shadow-sticker-md">
        <div className={cx("h-20 border-b-2 border-ink", ACCENT_BG[accent])} />
        <div className="flex flex-col gap-2 px-4 pb-4 -mt-10">
          <EmojiToken
            emoji="🙂"
            color={accent}
            size={76}
            rounded="toy"
            tilt={-5}
            className="animate-pop shadow-sticker-md"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-h2">@{profile.username}</span>
          </div>
          <div className="text-small font-semibold text-muted">
            joined {joinedLabel(profile.createdAt)} · 👥 {profile.friendsCount}{" "}
            {profile.friendsCount === 1 ? "friend" : "friends"}
          </div>
        </div>
      </StickerCard>

      {/* stats shelf */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill>
          🎮 {jams?.length ?? 0} {(jams?.length ?? 0) === 1 ? "jam" : "jams"}
        </Pill>
        <Pill>👥 {profile.friendsCount}</Pill>
        {profile.walletAddress && (
          <button
            onClick={() =>
              navigator.clipboard?.writeText(profile.walletAddress!).catch(() => {})
            }
            className="focus-ring ml-auto font-mono text-tiny font-semibold text-muted"
          >
            {short(profile.walletAddress)} 📋
          </button>
        )}
      </div>

      {/* social actions — balanced, never ragged */}
      {isFriend ? (
        <div className="flex flex-col gap-2">
          <StickerButton color="pink" size="lg" block onClick={payGate}>
            💸 Send money
          </StickerButton>
          <div className="grid grid-cols-2 gap-2">
            <StickerButton color="white" block onClick={toggleFriend} disabled={busy}>
              ✓ Friends
            </StickerButton>
            <StickerButton color="yellow" block onClick={askGate}>
              🙏 Ask for money
            </StickerButton>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <StickerButton color="green" block onClick={toggleFriend} disabled={busy}>
            + Add friend
          </StickerButton>
          <StickerButton color="pink" block onClick={payGate}>
            💸 Send money
          </StickerButton>
        </div>
      )}

      {asked && (
        <Pill color="green" className="self-start">
          asked ✓ — it's in their inbox
        </Pill>
      )}
      {!isFriend && isLoggedIn && (
        <div className="text-small font-semibold text-muted">
          add @{profile.username} as a friend to chat + ask for money
        </div>
      )}

      {/* their jams */}
      <div className="mt-1 flex flex-col gap-2">
        <div className="text-small font-extrabold uppercase tracking-wide text-muted">
          jams by @{profile.username}
        </div>
        {jams === null ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : jams.length === 0 ? (
          <div className="text-small font-semibold text-muted">
            @{profile.username} hasn't shipped a jam yet 🌱
          </div>
        ) : (
          <div className="flex flex-col gap-2 stagger">
            {jams.map((j, i) => (
              <Link key={j.id} href={`/j/${j.slug}`} className="focus-ring">
                <StickerCard
                  className="p-3.5 flex items-center gap-3 sticker-press"
                  tilt={i % 2 === 0 ? -0.3 : 0.3}
                >
                  <EmojiToken emoji={j.iconEmoji} color="blue" size={40} rounded="toy" />
                  <div className="flex flex-col min-w-0">
                    <div className="font-extrabold text-body truncate">{j.name}</div>
                    <div className="text-small font-semibold text-muted">
                      ♥ {j.likes} · ▸ {j.plays} · ★ {j.reviewCount}
                    </div>
                  </div>
                  <span className="ml-auto text-muted font-extrabold">›</span>
                </StickerCard>
              </Link>
            ))}
          </div>
        )}
      </div>

      {sheet && (
        <PayFriendSheet
          username={profile.username}
          action={sheet === "request" ? "request" : "pay"}
          onSend={sheet === "request" ? ask : pay}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
