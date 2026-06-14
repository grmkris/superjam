"use client";

// Public profile (DESIGN_BRIEF §3f) — `/u/<username>`, reached by tapping any
// @handle (reviews, maker row, …). Identity (@name + ENS + ✓-human) plus the three
// social actions: friend/unfriend, 💸 send money (works for anyone — on-chain via
// the confirm sheet), and 🙏 ask for money (friends-only — a request line that lands
// in your chat thread). Your own handle bounces to /me.
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "../../../components/confirm/confirm-provider";
import { PayFriendSheet } from "../../../components/chat/pay-friend-sheet";
import { NameTag } from "../../../components/name-tag";
import { VerifiedBadge } from "../../../components/verified-badge";
import { ensApp, userEns } from "../../../components/ui/brand";
import { EmojiToken, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import { useLogin } from "../../../components/login";
import { usePlatformClient } from "../../../components/use-platform-client";
import { useHostAuth } from "../../../lib/use-host-auth";

interface Profile {
  id: string;
  username: string;
  ensName: string | null;
  worldVerified: boolean;
  walletAddress: string | null;
  isMe: boolean;
  isFriend: boolean;
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

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
    const res = await confirm({
      kind: "payFriend",
      to: `@${profile.username}`,
      toName: profile.ensName ?? userEns(profile.username),
      amountUsdc,
      memo: note || undefined,
    }).catch(() => ({ approved: false, txHash: undefined as string | undefined }));
    if (res.approved && res.txHash) {
      // Records a money line in the chat thread — only when you're friends, so
      // best-effort: the on-chain transfer already happened either way.
      await client.chat
        .recordTip({ to: profile.username, txHash: res.txHash })
        .catch(() => {});
    }
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
        <Skeleton className="h-20" />
        <Skeleton className="h-14" />
        <Skeleton className="h-12" />
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

  return (
    <div className="screen gap-3">
      <button
        onClick={() => router.back()}
        className="focus-ring self-start text-body font-bold text-muted"
      >
        ‹ Back
      </button>

      {/* identity */}
      <StickerCard color="white" className="p-4 flex items-center gap-3 shadow-sticker-md">
        <EmojiToken emoji="🙂" color="green" size={56} rounded="toy" tilt={-5} />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-h3">@{profile.username}</span>
            {profile.worldVerified && <VerifiedBadge variant="pill" />}
          </div>
          <NameTag
            name={profile.ensName ?? userEns(profile.username)}
            state={profile.ensName ? "minted" : "pending"}
            href={profile.ensName ? ensApp(profile.ensName) : undefined}
          />
          {profile.walletAddress && (
            <button
              onClick={() =>
                navigator.clipboard?.writeText(profile.walletAddress!).catch(() => {})
              }
              className="focus-ring self-start font-mono text-tiny font-semibold text-muted"
            >
              {short(profile.walletAddress)} 📋
            </button>
          )}
        </div>
      </StickerCard>

      {/* social actions */}
      <div className="flex flex-wrap gap-2">
        <StickerButton
          color={isFriend ? "white" : "green"}
          size="md"
          onClick={toggleFriend}
          disabled={busy}
          className="rounded-full"
        >
          {isFriend ? "✓ Friends" : "+ Add friend"}
        </StickerButton>

        <StickerButton
          color="pink"
          size="md"
          onClick={() => (isLoggedIn ? setSheet("pay") : openLogin())}
          className="rounded-full"
        >
          💸 Send money
        </StickerButton>

        {isFriend && (
          <StickerButton
            color="yellow"
            size="md"
            onClick={() => (isLoggedIn ? setSheet("request") : openLogin())}
            className="rounded-full"
          >
            🙏 Ask for money
          </StickerButton>
        )}
      </div>

      {asked && (
        <div className="text-small font-bold text-green-ink">
          asked ✓ — they'll see it in their inbox
        </div>
      )}
      {!isFriend && isLoggedIn && (
        <div className="text-small font-semibold text-muted">
          add @{profile.username} as a friend to chat + ask for money
        </div>
      )}

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
