// app reviews (§12/§14) — one review per human per jam (the sharpest anti-sybil
// surface). UNIQUE(appId,userId) makes a 2nd submit an EDIT; every reviewer is
// World-verified BY CONSTRUCTION (the router gate). Identity is server-stamped.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { type AppId, LIST_MAX, type UserId } from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";

const { appReview, app, user } = schema;

const encodeCursor = (offset: number): string =>
  Buffer.from(String(offset), "utf8").toString("base64url");
const decodeCursor = (cursor?: string): number => {
  if (!cursor) {
    return 0;
  }
  const n = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const createReviewService = ({ db }: { db: Database }) => ({
  // PUBLIC: rows newest-first; every reviewer is World-verified by construction.
  async list(appId: AppId, cursor?: string) {
    const offset = decodeCursor(cursor);
    const rows = await db
      .select({
        username: user.username,
        worldVerified: user.worldVerified,
        rating: appReview.rating,
        text: appReview.text,
        createdAt: appReview.createdAt,
      })
      .from(appReview)
      .innerJoin(user, eq(appReview.userId, user.id))
      .where(eq(appReview.appId, appId))
      .orderBy(desc(appReview.createdAt))
      .limit(LIST_MAX + 1)
      .offset(offset);
    const hasMore = rows.length > LIST_MAX;
    return {
      reviews: rows.slice(0, LIST_MAX),
      cursor: hasMore ? encodeCursor(offset + LIST_MAX) : undefined,
    };
  },

  // Caller is World-verified (router gate). UNIQUE → 2nd submit edits in place.
  async upsert(appId: AppId, userId: UserId, rating: number, text?: string) {
    const appRow = await db.query.app.findFirst({
      columns: { ownerUserId: true },
      where: eq(app.id, appId),
    });
    if (!appRow) {
      throw new ORPCError("NOT_FOUND", { message: "Jam not found" });
    }
    if (appRow.ownerUserId === userId) {
      throw new ORPCError("FORBIDDEN", { message: "You can't review your own jam" });
    }
    const [row] = await db
      .insert(appReview)
      .values({ appId, userId, rating, text: text ?? null })
      .onConflictDoUpdate({
        target: [appReview.appId, appReview.userId],
        set: { rating, text: text ?? null },
      })
      .returning({ id: appReview.id, rating: appReview.rating });
    return row ?? { rating };
  },

  async remove(appId: AppId, userId: UserId): Promise<void> {
    await db
      .delete(appReview)
      .where(and(eq(appReview.appId, appId), eq(appReview.userId, userId)));
  },
});

export type ReviewService = ReturnType<typeof createReviewService>;
