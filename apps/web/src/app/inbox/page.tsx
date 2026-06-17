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
import { cx } from "../../components/ui/cx";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { Badge, Dot } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton } from "../../components/ui/skeleton";
import { Input } from "../../components/ui/field";
import { MicButton } from "../../components/ui/mic-button";
import { ToyboxTabs } from "../../components/ui/tabs";
import { HandleLink } from "../../components/handle-link";
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
    <div className="screen gap-3">
      <ToyboxTabs
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "notifications", label: "🔔 Notifications" },
          { value: "friends", label: "👋 Friends" },
        ]}
      />
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
    return (
      <div className="flex flex-1 flex-col gap-2.5">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  if (rows.length === 0) {
    return (
      <EmptyState emoji="📭" title="no mail yet" emojiColor="pink" className="flex-1">
        jams you play can challenge you
      </EmptyState>
    );
  }

  const anyUnread = rows.some((r) => !r.read);
  return (
    <div className="flex flex-col gap-2.5 stagger">
      {anyUnread && (
        <button onClick={markAll} className="focus-ring self-end text-small font-bold text-pink">
          Mark all read
        </button>
      )}
      {rows.map((n) => (
        <StickerCard
          key={n.id}
          color={n.read ? "white" : "cream"}
          className={cx("p-3.5 flex items-center gap-3", !n.read && "border-pink")}
        >
          {!n.read && <Dot className="border border-ink shrink-0" />}
          <div className="flex flex-col min-w-0 gap-0.5">
            <div className="flex items-center gap-1.5 text-small">
              <HandleLink username={n.from.username} className="font-extrabold" />
              <span className="text-muted font-semibold">· via {n.appName}</span>
            </div>
            <div className="text-small font-semibold leading-snug">{n.text}</div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <span className="text-tiny font-semibold text-muted">{ago(n.createdAt)}</span>
            {n.link && (
              <StickerButton
                color="blue"
                size="sm"
                onClick={() => router.push(n.link!)}
                className="rounded-full"
              >
                Open
              </StickerButton>
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
    return (
      <div className="flex flex-1 flex-col gap-2.5">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <div className="flex gap-2">
        <Input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="add a friend by @name…"
          className="flex-1 rounded-full text-small"
        />
        <StickerButton color="green" size="md" onClick={add} disabled={adding || !handle.trim()}>
          + Add
        </StickerButton>
      </div>

      {friends.length === 0 ? (
        <EmptyState emoji="👋" title="no crew yet" emojiColor="green" className="flex-1">
          add a friend to share jams + challenge
        </EmptyState>
      ) : (
        friends.map((f) => (
          <button key={f.id} onClick={() => setOpen(f)} className="text-left">
            <StickerCard className="p-3.5 flex items-center gap-3">
              <EmojiToken emoji="🙂" color="green" size={40} />
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold">@{f.username}</span>
              </div>
              {unread[f.username] ? (
                <Badge className="ml-auto">{unread[f.username]}</Badge>
              ) : null}
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
  kind: "text" | "card" | "tip" | "request";
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
  const [requesting, setRequesting] = useState(false);
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
      toName: `@${friend.username}`,
      amountUsdc,
      memo: note || undefined,
    }).catch(() => ({ approved: false, txHash: undefined as string | undefined }));
    if (res.approved && res.txHash) {
      // the money line is recorded server-side via payments.recordTip after the
      // public-rail send
      load();
    }
  };

  const shareJam = async (jamSlug: string, challenge: boolean) => {
    setPicking(false);
    await client.chat.shareJam({ to: friend.username, jamSlug, challenge }).catch(() => {});
    load();
  };

  const requestMoney = async (amountUsdc: number, note: string) => {
    setRequesting(false);
    await client.chat
      .requestMoney({ to: friend.username, amountUsdc: String(amountUsdc), note: note || undefined })
      .catch(() => {});
    load();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="focus-ring text-h3 font-bold text-muted" aria-label="Back">‹</button>
        <EmojiToken emoji="🙂" color="green" size={32} />
        <HandleLink
          username={friend.username}
          className="font-extrabold"
        />
      </div>

      <div className="flex flex-col gap-2 py-2 min-h-[40dvh]">
        {msgs.map((m) => (
          <div key={m.id} className={cx("max-w-[82%]", m.fromMe ? "self-end" : "self-start")}>
            {m.kind === "tip" ? (
              <div className="flex items-center gap-2 bg-green border-2 border-ink rounded-toy px-3.5 py-2 text-small font-extrabold shadow-sticker-sm">
                💸 {m.fromMe ? "sent" : "got"} {m.amountUsdc} USDC
              </div>
            ) : m.kind === "request" ? (
              <div className="flex flex-col gap-1.5 bg-yellow border-2 border-ink rounded-toy px-3.5 py-2.5 shadow-sticker-sm">
                <div className="text-small font-extrabold">
                  🙏 {m.fromMe ? "you asked for" : `@${friend.username} asked for`} {m.amountUsdc} USDC
                </div>
                {m.text && <div className="text-small font-semibold leading-snug">{m.text}</div>}
                {!m.fromMe && (
                  <StickerButton
                    color="green"
                    size="sm"
                    className="self-start rounded-full"
                    onClick={() => pay(Number(m.amountUsdc), m.text ?? "")}
                  >
                    Pay {m.amountUsdc} USDC →
                  </StickerButton>
                )}
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
                  "border-2 border-ink rounded-toy px-3.5 py-2 text-small font-semibold shadow-sticker-sm",
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

      <div className="flex gap-2 items-center sticky bottom-0 bg-cream pb-[calc(0.25rem+env(safe-area-inset-bottom))]">
        <button
          onClick={() => setPaying(true)}
          className="focus-ring size-11 bg-green border-2 border-ink rounded-full text-lg shadow-sticker-sm sticker-press shrink-0"
          aria-label="Pay a friend"
        >
          💸
        </button>
        <button
          onClick={() => setRequesting(true)}
          className="focus-ring size-11 bg-yellow border-2 border-ink rounded-full text-lg shadow-sticker-sm sticker-press shrink-0"
          aria-label="Ask for money"
        >
          🙏
        </button>
        <button
          onClick={() => setPicking(true)}
          className="focus-ring size-11 bg-blue border-2 border-ink rounded-full text-lg shadow-sticker-sm sticker-press shrink-0"
          aria-label="Share a jam"
        >
          🎮
        </button>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="message…"
          className="flex-1 rounded-full text-small min-w-0"
        />
        <MicButton value={draft} onChange={setDraft} />
      </div>

      {picking && <JamPicker onPick={shareJam} onClose={() => setPicking(false)} />}
      {paying && (
        <PayFriendSheet
          username={friend.username}
          onSend={pay}
          onClose={() => setPaying(false)}
        />
      )}
      {requesting && (
        <PayFriendSheet
          username={friend.username}
          action="request"
          onSend={requestMoney}
          onClose={() => setRequesting(false)}
        />
      )}
    </div>
  );
}
