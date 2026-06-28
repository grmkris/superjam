// Friends (§3e) — instant + mutual. One canonical-pair row per friendship
// (userAId < userBId by branded-id string order), so membership is symmetric and
// `add` is idempotent. Used by the friends router + as the gate for chat.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import type { UserId } from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

const { friendship, user } = schema;

/** Canonical (smaller-first) ordering so a↔b is one stable row. */
export const canonicalPair = (a: UserId, b: UserId): [UserId, UserId] =>
  a < b ? [a, b] : [b, a];

export const createFriendService = ({ db }: { db: Database }) => {
  const resolveUserId = async (username: string): Promise<UserId> => {
    const handle = username.trim().toLowerCase().replace(/^@/, "");
    const u = await db.query.user.findFirst({
      columns: { id: true },
      where: eq(user.username, handle),
    });
    if (!u) {
      throw new ORPCError("BAD_REQUEST", { message: `Unknown user @${handle}` });
    }
    return u.id;
  };

  const areFriends = async (me: UserId, other: UserId): Promise<boolean> => {
    const [a, b] = canonicalPair(me, other);
    const row = await db.query.friendship.findFirst({
      columns: { id: true },
      where: and(eq(friendship.userAId, a), eq(friendship.userBId, b)),
    });
    return Boolean(row);
  };

  return {
    resolveUserId,
    areFriends,

    /** How many friends a user has (symmetric — either side of the pair). */
    async count(userId: UserId): Promise<number> {
      const [row] = await db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(friendship)
        .where(
          or(eq(friendship.userAId, userId), eq(friendship.userBId, userId))
        );
      return Number(row?.cnt ?? 0);
    },

    /** The OTHER party of each of my friendships. */
    async list(me: UserId) {
      const pairs = await db
        .select({ a: friendship.userAId, b: friendship.userBId })
        .from(friendship)
        .where(or(eq(friendship.userAId, me), eq(friendship.userBId, me)));
      const otherIds = pairs.map((p) => (p.a === me ? p.b : p.a));
      if (otherIds.length === 0) return { friends: [] };
      const friends = await db
        .select({
          id: user.id,
          username: user.username,
          ensName: user.ensName,
          worldVerified: user.worldVerified,
        })
        .from(user)
        .where(inArray(user.id, otherIds))
        .orderBy(asc(user.username));
      return { friends };
    },

    async add(me: UserId, username: string): Promise<{ ok: true }> {
      const other = await resolveUserId(username);
      if (other === me) {
        throw new ORPCError("BAD_REQUEST", { message: "Can't add yourself" });
      }
      const [a, b] = canonicalPair(me, other);
      await db
        .insert(friendship)
        .values({ userAId: a, userBId: b })
        .onConflictDoNothing();
      return { ok: true };
    },

    async remove(me: UserId, username: string): Promise<{ ok: true }> {
      const other = await resolveUserId(username);
      const [a, b] = canonicalPair(me, other);
      await db
        .delete(friendship)
        .where(and(eq(friendship.userAId, a), eq(friendship.userBId, b)));
      return { ok: true };
    },
  };
};

export type FriendService = ReturnType<typeof createFriendService>;
