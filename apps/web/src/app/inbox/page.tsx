"use client";

// Inbox (DESIGN_BRIEF §3e) — two tabs: Notifications · Friends. Notifications =
// app→user mail (inbox.list). Friends = your crew + real chat threads where text,
// jam cards, challenges, and tips travel; 💸 opens Pay a friend (≤25 USDC confirm
// sheet) → recorded as a money line both sides.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "../../components/confirm/confirm-provider";
import { JamPicker } from "../../components/chat/jam-picker";
import { MessageCard } from "../../components/chat/message-card";
import { PayFriendSheet } from "../../components/chat/pay-friend-sheet";
import { userEns } from "../../components/ui/brand";
import { cx } from "../../components/ui/cx";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { VerifiedBadge } from "../../components/verified-badge";
import { usePlatformClient } from "../../components/use-platform-client";
import { useHostAuth } from "../../lib/use-host-auth";

type Tab = "notifications" | "friends";

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

  if (rows === null)
    return <div className="flex-1 grid place-items-center text-muted font-semibold">loading…</div>;
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
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
                onClick={() => router.push(n.link!)}
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

interface Friend {
  id: string;
  username: string;
  ensName: string | null;
  worldVerified: boolean;
}

function Friends() {
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<Friend | null>(null);
  const [handle, setHandle] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setFriends([]);
      return;
    }
    client.friends
      .list()
      .then((r) => setFriends(r.friends))
      .catch(() => setFriends([]));
    client.chat
      .threads()
      .then((r) => {
        const m: Record<string, number> = {};
        for (const t of r.threads) m[t.withUser.username] = t.unread;
        setUnread(m);
      })
      .catch(() => {});
  }, [client, isLoggedIn]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const u = handle.trim().replace(/^@/, "").toLowerCase();
    if (!u) return;
    setAdding(true);
    try {
      await client.friends.add({ username: u });
      setHandle("");
      load();
    } catch {
      /* unknown user / self — surfaced by the list not changing */
    } finally {
      setAdding(false);
    }
  };

  if (open) return <ChatThread friend={open} onBack={() => { setOpen(null); load(); }} />;
  if (friends === null)
    return <div className="flex-1 grid place-items-center text-muted font-semibold">loading…</div>;

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <div className="flex gap-2">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="add a friend by @name…"
          className="flex-1 bg-card border-2 border-ink rounded-full px-4 py-2.5 text-[13.5px] font-semibold placeholder:text-muted outline-none focus:border-pink"
        />
        <StickerButton color="green" size="md" onClick={add} disabled={adding || !handle.trim()}>
          + Add
        </StickerButton>
      </div>

      {friends.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <div className="text-5xl">👋</div>
          <div className="font-extrabold text-lg">no crew yet</div>
          <div className="text-muted font-semibold text-sm">add a friend to share jams + challenge</div>
        </div>
      ) : (
        friends.map((f) => (
          <button key={f.id} onClick={() => setOpen(f)} className="text-left">
            <StickerCard className="p-3.5 flex items-center gap-3">
              <EmojiToken emoji="🙂" color="green" size={40} />
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold">@{f.username}</span>
                {f.worldVerified && <VerifiedBadge />}
              </div>
              {unread[f.username] ? (
                <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-pink border-2 border-ink text-white text-[11px] font-extrabold">
                  {unread[f.username]}
                </span>
              ) : (
                <span className="ml-auto font-mono text-[11px] text-muted truncate max-w-[40%]">
                  {f.ensName ?? userEns(f.username)}
                </span>
              )}
            </StickerCard>
          </button>
        ))
      )}
    </div>
  );
}

interface Msg {
  id: string;
  fromMe: boolean;
  kind: "text" | "card" | "tip";
  text: string | null;
  card: { title: string; body?: string; icon?: string; cta?: string } | null;
  link: string | null;
  amountUsdc: string | null;
  via: { name: string; iconEmoji: string } | null;
  createdAt: string | number | Date;
}

function ChatThread({ friend, onBack }: { friend: Friend; onBack: () => void }) {
  const client = usePlatformClient();
  const router = useRouter();
  const { confirm } = useConfirm();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const [paying, setPaying] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await client.chat.history({ withUsername: friend.username });
      setMsgs((r.messages as Msg[]).toReversed()); // oldest→newest for display
    } catch {
      /* not friends / transient */
    }
  }, [client, friend.username]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await client.chat.history({ withUsername: friend.username });
        if (!cancelled) setMsgs((r.messages as Msg[]).toReversed());
      } catch {
        /* not friends / transient */
      }
    };
    tick();
    client.chat.markRead({ withUsername: friend.username }).catch(() => {});
    const t = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [client, friend.username]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await client.chat.send({ to: friend.username, text }).catch(() => {});
    load();
  };

  const pay = async (amountUsdc: number, note: string) => {
    setPaying(false);
    const res = await confirm({
      kind: "payFriend",
      to: `@${friend.username}`,
      toName: friend.ensName ?? userEns(friend.username),
      amountUsdc,
      memo: note || undefined,
    }).catch(() => ({ approved: false, txHash: undefined as string | undefined }));
    if (res.approved && res.txHash) {
      // the money line is recorded server-side from the verified on-chain tx
      await client.chat.recordTip({ to: friend.username, txHash: res.txHash }).catch(() => {});
      load();
    }
  };

  const shareJam = async (jamSlug: string, challenge: boolean) => {
    setPicking(false);
    await client.chat.shareJam({ to: friend.username, jamSlug, challenge }).catch(() => {});
    load();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-[18px] font-bold text-muted">‹</button>
        <EmojiToken emoji="🙂" color="green" size={32} />
        <span className="font-extrabold">@{friend.username}</span>
        {friend.worldVerified && <VerifiedBadge />}
      </div>

      <div className="flex flex-col gap-2 py-2 min-h-[40dvh]">
        {msgs.map((m) => (
          <div key={m.id} className={cx("max-w-[82%]", m.fromMe ? "self-end" : "self-start")}>
            {m.kind === "tip" ? (
              <div className="flex items-center gap-2 bg-green border-2 border-ink rounded-2xl px-3.5 py-2 text-sm font-extrabold shadow-sticker-sm">
                💸 {m.fromMe ? "sent" : "got"} {m.amountUsdc} USDC
              </div>
            ) : m.kind === "card" && m.card ? (
              <MessageCard
                card={m.card}
                via={m.via}
                mine={m.fromMe}
                onCta={m.link ? () => router.push(m.link!) : undefined}
              />
            ) : (
              <div
                className={cx(
                  "border-2 border-ink rounded-2xl px-3.5 py-2 text-[13.5px] font-semibold shadow-sticker-sm",
                  m.fromMe ? "bg-pink text-white rounded-br-sm" : "bg-card rounded-bl-sm"
                )}
              >
                {m.text}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 items-center sticky bottom-0 bg-cream pb-1">
        <button
          onClick={() => setPaying(true)}
          className="w-11 h-11 bg-green border-2 border-ink rounded-full text-lg shadow-sticker-sm sticker-press shrink-0"
          aria-label="Pay a friend"
        >
          💸
        </button>
        <button
          onClick={() => setPicking(true)}
          className="w-11 h-11 bg-yellow border-2 border-ink rounded-full text-lg shadow-sticker-sm sticker-press shrink-0"
          aria-label="Share a jam"
        >
          🎮
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="message…"
          className="flex-1 bg-card border-2 border-ink rounded-full px-4 py-3 text-[13.5px] font-semibold placeholder:text-muted outline-none focus:border-pink min-w-0"
        />
      </div>

      {picking && <JamPicker onPick={shareJam} onClose={() => setPicking(false)} />}
      {paying && (
        <PayFriendSheet
          username={friend.username}
          onSend={pay}
          onClose={() => setPaying(false)}
        />
      )}
    </div>
  );
}
