// sdk.messages + host /inbox (§9/§12). One-way notify/invite; recipient-side
// inbox. Caps: 5/min/(from,to), 20/min/from (in-memory, single process).
// Inbox evicts at INBOX_CAP, oldest READ first.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppId,
  INBOX_CAP,
  LIST_MAX,
  type MessageId,
  MSG_DATA_MAX_BYTES,
  MSG_PER_PAIR_PER_MIN,
  MSG_PER_SENDER_PER_MIN,
  type UserId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq } from "drizzle-orm";
import type { RateLimiter } from "../lib/rate-limit.ts";
import { assertSize, normalizeInboxLink } from "../lib/validate.ts";

const { appMessage, app, user } = schema;

export interface SendInput {
  to: string;
  text: string;
  data?: Record<string, unknown>;
  link?: string;
}

export const createMessageService = ({
  db,
  rateLimiter,
}: {
  db: Database;
  rateLimiter: RateLimiter;
}) => {
  const evictInbox = async (toUserId: UserId): Promise<void> => {
    const counted = await db
      .select({ c: count() })
      .from(appMessage)
      .where(eq(appMessage.toUserId, toUserId));
    const over = Number(counted[0]?.c ?? 0) - INBOX_CAP;
    if (over <= 0) {
      return;
    }
    // Oldest READ first: read DESC (true precedes false), then createdAt ASC.
    const victims = await db
      .select({ id: appMessage.id })
      .from(appMessage)
      .where(eq(appMessage.toUserId, toUserId))
      .orderBy(desc(appMessage.read), asc(appMessage.createdAt))
      .limit(over);
    for (const v of victims) {
      await db.delete(appMessage).where(eq(appMessage.id, v.id));
    }
  };

  return {
    async send(
      appId: AppId,
      from: { id: UserId; username: string },
      input: SendInput
    ): Promise<{ id: MessageId }> {
      const target = input.to.toLowerCase();
      const recipient = await db.query.user.findFirst({
        columns: { id: true },
        where: eq(user.username, target),
      });
      if (!recipient) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Unknown user @${target}`,
        });
      }
      if (recipient.id === from.id) {
        throw new ORPCError("BAD_REQUEST", { message: "Cannot message yourself" });
      }
      if (input.data) {
        assertSize(input.data, MSG_DATA_MAX_BYTES, "message data");
      }
      const link = input.link ? normalizeInboxLink(input.link) : null;

      if (
        !rateLimiter.allow(`msg:${from.id}`, MSG_PER_SENDER_PER_MIN) ||
        !rateLimiter.allow(`msg:${from.id}>${recipient.id}`, MSG_PER_PAIR_PER_MIN)
      ) {
        throw new ORPCError("RATE_LIMITED", { message: "Too many messages" });
      }

      const [created] = await db
        .insert(appMessage)
        .values({
          appId,
          fromUserId: from.id,
          toUserId: recipient.id,
          text: input.text,
          data: input.data,
          link,
        })
        .returning({ id: appMessage.id });
      await evictInbox(recipient.id);
      return { id: created!.id };
    },

    // sdk.messages.list — sent TO me via THIS app, newest-first.
    async listForApp(appId: AppId, me: UserId, limit = 50) {
      const rows = await db
        .select({
          id: appMessage.id,
          from: user.username,
          text: appMessage.text,
          data: appMessage.data,
          link: appMessage.link,
          createdAt: appMessage.createdAt,
          read: appMessage.read,
        })
        .from(appMessage)
        .innerJoin(user, eq(appMessage.fromUserId, user.id))
        .where(and(eq(appMessage.toUserId, me), eq(appMessage.appId, appId)))
        .orderBy(desc(appMessage.createdAt))
        .limit(Math.min(limit, LIST_MAX));
      return rows;
    },

    // Host /inbox — all messages TO me, across apps, with attribution.
    async inbox(me: UserId) {
      const rows = await db
        .select({
          id: appMessage.id,
          from: user.username,
          appName: app.name,
          appSlug: app.slug,
          text: appMessage.text,
          data: appMessage.data,
          link: appMessage.link,
          createdAt: appMessage.createdAt,
          read: appMessage.read,
        })
        .from(appMessage)
        .innerJoin(user, eq(appMessage.fromUserId, user.id))
        .innerJoin(app, eq(appMessage.appId, app.id))
        .where(eq(appMessage.toUserId, me))
        .orderBy(desc(appMessage.createdAt))
        .limit(INBOX_CAP);
      const unread = rows.reduce((n, r) => n + (r.read ? 0 : 1), 0);
      return {
        unread,
        messages: rows.map((r) => ({ ...r, from: { username: r.from } })),
      };
    },

    async markAllRead(me: UserId): Promise<void> {
      await db
        .update(appMessage)
        .set({ read: true })
        .where(and(eq(appMessage.toUserId, me), eq(appMessage.read, false)));
    },
  };
};

export type MessageService = ReturnType<typeof createMessageService>;
