"use client";

// Inbox (DESIGN_BRIEF §3e) — two tabs: Notifications · Friends. The only push
// channel: tips, challenges, friend requests, jam mail. A row with a validated
// invite link gets an Open button → into the jam. Friends → chat threads where
// jams/tips/links travel; 💸 opens Pay a friend (same ≤25 USDC confirm-sheet).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "../../components/confirm/confirm-provider";
import { userEns } from "../../components/ui/brand";
import { cx } from "../../components/ui/cx";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { VerifiedBadge } from "../../components/verified-badge";
import { usePlatformClient } from "../../components/use-platform-client";
import { useHostAuth } from "../../lib/use-host-auth";

type Tab = "notifications" | "friends";

interface Notif {
  id: string;
  from: { username: string };
  appName: string;
  appSlug: string;
  text: string;
  link: string | null;
  read: boolean;
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

export default function InboxPage() {
  const [tab, setTab] = useState<Tab>("notifications");
  return (
    <div className="flex flex-col gap-3 px-5 pt-14 pb-6 bg-cream min-h-full">
      <div className="text-[26px] font-extrabold">Inbox</div>
      <div className="flex bg-card border-2 border-ink rounded-full p-1 gap-1">
        {(["notifications", "friends"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "flex-1 rounded-full py-2 text-[13.5px] capitalize",
              tab === t ? "bg-ink text-cream font-extrabold" : "text-muted font-semibold"
            )}
          >
            {t === "notifications" ? "🔔 Notifications" : "👋 Friends"}
          </button>
        ))}
      </div>
      {tab === "notifications" ? <Notifications /> : <Friends />}
    </div>
  );
}

function Notifications() {
  const router = useRouter();
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const [rows, setRows] = useState<Notif[] | null>(null);

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setRows([]);
      return;
    }
    client.inbox
      .list()
      .then((r) => setRows(r.messages as Notif[]))
      .catch(() => setRows([]));
  }, [client, isLoggedIn]);

  useEffect(() => {
    load();
  }, [load]);

  const markAll = async () => {
    await client.inbox.markRead().catch(() => {});
    setRows((rs) => rs?.map((r) => ({ ...r, read: true })) ?? rs);
  };

  if (rows === null) return <div className="text-muted font-semibold py-6">loading…</div>;
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="text-5xl">📭</div>
        <div className="font-extrabold text-lg">no mail yet</div>
        <div className="text-muted font-semibold text-sm">
          jams you play can challenge you
        </div>
      </div>
    );
  }

  const anyUnread = rows.some((r) => !r.read);
  return (
    <div className="flex flex-col gap-2.5">
      {anyUnread && (
        <button onClick={markAll} className="self-end text-[13px] font-bold text-pink">
          Mark all read
        </button>
      )}
      {rows.map((n) => (
        <StickerCard
          key={n.id}
          color={n.read ? "white" : "cream"}
          className={cx("p-3.5 flex items-center gap-3", !n.read && "border-pink")}
        >
          {!n.read && <span className="w-2 h-2 rounded-full bg-pink border border-ink shrink-0" />}
          <div className="flex flex-col min-w-0 gap-0.5">
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="font-extrabold">@{n.from.username}</span>
              <VerifiedBadge />
              <span className="text-muted font-semibold">· via {n.appName}</span>
            </div>
            <div className="text-[13.5px] font-semibold leading-snug">{n.text}</div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <span className="text-[11px] font-semibold text-muted">{ago(n.createdAt)}</span>
            {n.link && (
              <button
                onClick={() => router.push(`/app/${n.appSlug}`)}
                className="bg-blue text-white border-2 border-ink rounded-full px-3 py-1 text-xs font-extrabold shadow-sticker-sm sticker-press"
              >
                Open
              </button>
            )}
          </div>
        </StickerCard>
      ))}
    </div>
  );
}

// ── Friends + chat + pay-a-friend ────────────────────────────────────────────
// TODO(seam): friends/crew + user-to-user chat have no router yet; presented
// with a demo crew. Pay-a-friend uses the real confirm sheet (stubbed executor).
interface Friend {
  username: string;
  emoji: string;
  color: "green" | "blue" | "yellow" | "pink";
}
const CREW: Friend[] = [
  { username: "mira", emoji: "🦊", color: "green" },
  { username: "theo", emoji: "🐻", color: "blue" },
  { username: "nika", emoji: "🐸", color: "yellow" },
];

function Friends() {
  const [open, setOpen] = useState<Friend | null>(null);
  if (open) return <ChatThread friend={open} onBack={() => setOpen(null)} />;
  return (
    <div className="flex flex-col gap-2.5">
      {CREW.map((f) => (
        <button key={f.username} onClick={() => setOpen(f)} className="text-left">
          <StickerCard className="p-3.5 flex items-center gap-3">
            <EmojiToken emoji={f.emoji} color={f.color} size={40} />
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold">@{f.username}</span>
              <VerifiedBadge />
            </div>
            <span className="ml-auto font-mono text-[11px] text-muted truncate max-w-[40%]">
              {userEns(f.username)}
            </span>
          </StickerCard>
        </button>
      ))}
      <StickerButton color="white" size="md" block>
        + Add friend
      </StickerButton>
    </div>
  );
}

interface Line {
  mine: boolean;
  text?: string;
  money?: number;
}

function ChatThread({ friend, onBack }: { friend: Friend; onBack: () => void }) {
  const { confirm } = useConfirm();
  const [lines, setLines] = useState<Line[]>([
    { mine: false, text: "gg on trivia 😤" },
    { mine: true, text: "rematch?" },
  ]);
  const [draft, setDraft] = useState("");

  const pay = async () => {
    const res = await confirm({
      kind: "payFriend",
      to: friend.username,
      toName: userEns(friend.username),
      amountUsdc: 1,
      memo: "coffee ☕",
    }).catch(() => ({ approved: false, txHash: undefined as string | undefined }));
    if (res.approved) setLines((l) => [...l, { mine: true, money: 1 }]);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-[15px] font-bold text-muted">
          ‹
        </button>
        <EmojiToken emoji={friend.emoji} color={friend.color} size={32} />
        <span className="font-extrabold">@{friend.username}</span>
        <VerifiedBadge />
      </div>
      <div className="flex flex-col gap-2 py-2">
        {lines.map((l, i) => (
          <div key={i} className={cx("max-w-[78%]", l.mine ? "self-end" : "self-start")}>
            {l.money != null ? (
              <div className="flex items-center gap-2 bg-green border-2 border-ink rounded-2xl px-3.5 py-2 text-sm font-extrabold shadow-sticker-sm">
                💸 sent {l.money.toFixed(2)} USDC
              </div>
            ) : (
              <div
                className={cx(
                  "border-2 border-ink rounded-2xl px-3.5 py-2 text-[13.5px] font-semibold shadow-sticker-sm",
                  l.mine ? "bg-pink text-white rounded-br-sm" : "bg-card rounded-bl-sm"
                )}
              >
                {l.text}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={pay}
          className="w-12 h-12 bg-green border-2 border-ink rounded-full text-xl font-extrabold shadow-sticker-sm sticker-press"
          aria-label="Pay a friend"
        >
          💸
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              setLines((l) => [...l, { mine: true, text: draft.trim() }]);
              setDraft("");
            }
          }}
          placeholder="message…"
          className="flex-1 bg-card border-2 border-ink rounded-full px-4 py-3 text-[13.5px] font-semibold placeholder:text-muted outline-none focus:border-pink"
        />
      </div>
    </div>
  );
}
