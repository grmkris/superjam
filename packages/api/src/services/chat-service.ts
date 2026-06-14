// Chat (§3e) — the user↔user direct-message stream, friendship-gated. Carries
// text, app/host "card" messages (share a jam / challenge → a render-spec + a
// deeplink CTA), and tip money lines. Mirrors message-service's rate-limit +
// username-resolution patterns; chat history is persistent (no INBOX_CAP evict).
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppId,
  type DmCard,
  LIST_MAX,
  MSG_PER_PAIR_PER_MIN,
  MSG_PER_SENDER_PER_MIN,
  TX_CAP_USDC,
  type UserId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { aliasedTable, and, desc, eq, inArray, or } from "drizzle-orm";
import type { RateLimiter } from "../lib/rate-limit.ts";
import { normalizeInboxLink } from "./../lib/validate.ts";
import { createFriendService } from "./friend-service.ts";

const { directMessage, app, user } = schema;

// Offset cursor (mirrors review-service; duplicated per-service by house style).
const encodeCursor = (offset: number): string =>
  Buffer.from(String(offset), "utf8").toString("base64url");
const decodeCursor = (cursor?: string): number => {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Build a platform deeplink with app-defined params. The base64 MUST match the
// viewer's parseLaunch (app-frame.tsx): JSON.parse(decodeURIComponent(escape(
// atob(d)))) — the standard UTF-8-safe base64 idiom. Node's
// Buffer.from(json,"utf8").toString("base64") produces exactly that base64 (same
// as the host's btoa(unescape(encodeURIComponent(json)))). encodeURIComponent
// then makes the +/=//chars query-safe; URLSearchParams.get decodes them back.
// Verified round-trip incl. emoji/accents — do NOT "simplify" the escape() away.
const deeplink = (slug: string, params?: Record<string, unknown>): string => {
  if (!params) return normalizeInboxLink(`/app/${slug}`);
  const d = encodeURIComponent(
    Buffer.from(JSON.stringify(params), "utf8").toString("base64")
  );
  return normalizeInboxLink(`/app/${slug}?d=${d}`);
};

export interface Sender {
  id: UserId;
  username: string;
}

export const createChatService = ({
  db,
  rateLimiter,
}: {
  db: Database;
  rateLimiter: RateLimiter;
}) => {
  const friends = createFriendService({ db });

  const assertFriend = async (me: UserId, other: UserId): Promise<void> => {
    if (!(await friends.areFriends(me, other))) {
      throw new ORPCError("FORBIDDEN", {
        message: "You can only message friends",
      });
    }
  };

  const checkRate = (fromId: UserId, toId: UserId): void => {
    if (
      !rateLimiter.allow(`chat:${fromId}`, MSG_PER_SENDER_PER_MIN) ||
      !rateLimiter.allow(`chat:${fromId}>${toId}`, MSG_PER_PAIR_PER_MIN)
    ) {
      throw new ORPCError("RATE_LIMITED", { message: "Too many messages" });
    }
  };

  const insert = async (
    values: typeof directMessage.$inferInsert
  ): Promise<{ id: string }> => {
    const [row] = await db
      .insert(directMessage)
      .values(values)
      .returning({ id: directMessage.id });
    return { id: row!.id };
  };

  // A jam the card was sent through; looked up + validated (listed/deployed).
  const requireJam = async (slug: string) => {
    const jam = await db.query.app.findFirst({
      columns: { id: true, slug: true, name: true, iconEmoji: true },
      where: and(
        eq(app.slug, slug),
        inArray(app.status, ["listed", "deployed"])
      ),
    });
    if (!jam) throw new ORPCError("NOT_FOUND", { message: "Jam not found" });
    return jam;
  };

  return {
    /** One entry per friend I've exchanged messages with: last + unread. */
    async threads(me: UserId) {
      const rows = await db
        .select()
        .from(directMessage)
        .where(
          or(eq(directMessage.fromUserId, me), eq(directMessage.toUserId, me))
        )
        .orderBy(desc(directMessage.createdAt))
        .limit(500);

      const byOther = new Map<
        UserId,
        { last: (typeof rows)[number]; unread: number }
      >();
      for (const r of rows) {
        const otherId = (r.fromUserId === me ? r.toUserId : r.fromUserId) as UserId;
        const entry = byOther.get(otherId) ?? { last: r, unread: 0 };
        if (!byOther.has(otherId)) byOther.set(otherId, entry);
        if (r.toUserId === me && !r.read) entry.unread += 1;
      }

      const otherIds = [...byOther.keys()];
      const people = otherIds.length
        ? await db
            .select({
              id: user.id,
              username: user.username,
              ensName: user.ensName,
              worldVerified: user.worldVerified,
            })
            .from(user)
            .where(inArray(user.id, otherIds))
        : [];
      const personOf = new Map(people.map((p) => [p.id, p]));

      const threads = otherIds
        .map((id) => {
          const { last, unread } = byOther.get(id)!;
          const who = personOf.get(id);
          return {
            withUser: {
              id,
              username: who?.username ?? "someone",
              ensName: who?.ensName ?? null,
              worldVerified: who?.worldVerified ?? false,
            },
            last: {
              kind: last.kind,
              text: last.text,
              card: last.card,
              fromMe: last.fromUserId === me,
              createdAt: last.createdAt,
            },
            unread,
          };
        })
        .toSorted((a, b) => b.last.createdAt.getTime() - a.last.createdAt.getTime());

      const totalUnread = threads.reduce((n, t) => n + t.unread, 0);
      return { threads, totalUnread };
    },

    /** Full conversation with one friend (both directions), newest-first. */
    async history(me: UserId, withUsername: string, cursor?: string) {
      const other = await friends.resolveUserId(withUsername);
      await assertFriend(me, other);
      const offset = decodeCursor(cursor);
      const viaApp = aliasedTable(app, "via_app");
      const rows = await db
        .select({
          id: directMessage.id,
          fromUserId: directMessage.fromUserId,
          kind: directMessage.kind,
          text: directMessage.text,
          card: directMessage.card,
          link: directMessage.link,
          amountUsdc: directMessage.amountUsdc,
          txHash: directMessage.txHash,
          read: directMessage.read,
          createdAt: directMessage.createdAt,
          viaName: viaApp.name,
          viaIcon: viaApp.iconEmoji,
        })
        .from(directMessage)
        .leftJoin(viaApp, eq(directMessage.viaAppId, viaApp.id))
        .where(
          or(
            and(
              eq(directMessage.fromUserId, me),
              eq(directMessage.toUserId, other)
            ),
            and(
              eq(directMessage.fromUserId, other),
              eq(directMessage.toUserId, me)
            )
          )
        )
        .orderBy(desc(directMessage.createdAt))
        .limit(LIST_MAX + 1)
        .offset(offset);

      const hasMore = rows.length > LIST_MAX;
      const page = hasMore ? rows.slice(0, LIST_MAX) : rows;
      return {
        messages: page.map((r) => ({
          id: r.id,
          fromMe: r.fromUserId === me,
          kind: r.kind,
          text: r.text,
          card: r.card,
          link: r.link,
          amountUsdc: r.amountUsdc,
          txHash: r.txHash,
          read: r.read,
          createdAt: r.createdAt,
          via: r.viaName ? { name: r.viaName, iconEmoji: r.viaIcon } : null,
        })),
        cursor: hasMore ? encodeCursor(offset + LIST_MAX) : undefined,
      };
    },

    async send(from: Sender, to: string, text: string) {
      const other = await friends.resolveUserId(to);
      await assertFriend(from.id, other);
      checkRate(from.id, other);
      return insert({
        fromUserId: from.id,
        toUserId: other,
        kind: "text",
        text,
      });
    },

    /** Ask a friend for money — a `request` line the recipient can pay straight
     *  from the thread (the Pay button reuses the payFriend confirm flow). No
     *  money moves here; it's a request, friendship-gated like every DM. */
    async requestMoney(from: Sender, to: string, amountUsdc: string, note?: string) {
      const other = await friends.resolveUserId(to);
      await assertFriend(from.id, other);
      checkRate(from.id, other);
      const n = Number(amountUsdc);
      if (!Number.isFinite(n) || n <= 0 || n > Number(TX_CAP_USDC)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Enter 0–${TX_CAP_USDC} USDC`,
        });
      }
      return insert({
        fromUserId: from.id,
        toUserId: other,
        kind: "request",
        amountUsdc,
        text: note ?? null,
      });
    },

    /** Share a jam (playable card) or challenge (card + deeplink) to a friend. */
    async shareJam(
      from: Sender,
      to: string,
      jamSlug: string,
      challenge?: boolean,
      note?: string
    ) {
      const other = await friends.resolveUserId(to);
      await assertFriend(from.id, other);
      checkRate(from.id, other);
      const jam = await requireJam(jamSlug);
      const card: DmCard = {
        title: jam.name,
        icon: jam.iconEmoji,
        body: note,
        cta: challenge ? "Accept challenge" : "Play",
      };
      const link = challenge
        ? deeplink(jam.slug, { challengedBy: from.username })
        : deeplink(jam.slug);
      return insert({
        fromUserId: from.id,
        toUserId: other,
        viaAppId: jam.id,
        kind: "card",
        card,
        link,
        text: note ?? null,
      });
    },

    /** A card from an app via the SDK (bridge.social.send). Deeplink uses the
     *  CALLING app's slug + app-defined params. Friendship-gated. */
    async sendAppCard(
      appId: AppId,
      from: Sender,
      args: {
        to: string;
        card: DmCard;
        slug: string;
        params?: Record<string, unknown>;
      }
    ) {
      const other = await friends.resolveUserId(args.to);
      await assertFriend(from.id, other);
      checkRate(from.id, other);
      return insert({
        fromUserId: from.id,
        toUserId: other,
        viaAppId: appId,
        kind: "card",
        card: args.card,
        link: deeplink(args.slug, args.params),
      });
    },

    /** Record a completed PRIVATE (Unlink) tip / pay-a-friend as a money line.
     *  SERVER-AUTHORITATIVE: payments.privateSend has ALREADY executed the shielded
     *  transfer server-side (the server holds the delegated signer), so there's no
     *  public Transfer log to read — we trust the move and record the line, with the
     *  amount taken from the same call that moved the money. Friends-only +
     *  idempotent on txHash (no double-record / replay). */
    async recordPrivateTip(
      from: Sender,
      toUsername: string,
      amountUsdc: string,
      txHash: string
    ) {
      const other = await friends.resolveUserId(toUsername);
      await assertFriend(from.id, other);

      const dup = await db.query.directMessage.findFirst({
        columns: { id: true },
        where: eq(directMessage.txHash, txHash),
      });
      if (dup) return { id: dup.id };

      return insert({
        fromUserId: from.id,
        toUserId: other,
        kind: "tip",
        amountUsdc,
        txHash,
        text: `sent ${amountUsdc} USDC`,
      });
    },

    async markRead(me: UserId, withUsername: string): Promise<{ ok: true }> {
      const other = await friends.resolveUserId(withUsername);
      await db
        .update(directMessage)
        .set({ read: true })
        .where(
          and(
            eq(directMessage.toUserId, me),
            eq(directMessage.fromUserId, other),
            eq(directMessage.read, false)
          )
        );
      return { ok: true };
    },
  };
};

export type ChatService = ReturnType<typeof createChatService>;
