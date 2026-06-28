// sdk.data — app-public shared collections (§9). Identity is server-stamped;
// update/delete are OWN-rows-only. where = top-level equality (≤3 keys, jsonb
// containment); orderBy = createdAt | a numeric data field (cast, NULLS LAST).
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppId,
  DOC_MAX_BYTES,
  LIST_MAX,
  RECORDS_MAX_PER_APP,
  type RecordId,
  type UserId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import { assertName, assertSize } from "../lib/validate.ts";

const { appRecord } = schema;

export interface Stamp {
  id: UserId;
  username: string;
  worldVerified: boolean;
}

export interface Doc {
  id: RecordId;
  userId: UserId;
  username: string;
  worldVerified: boolean;
  createdAt: Date;
  data: Record<string, unknown>;
}

export interface ListOpts {
  where?: Record<string, unknown>;
  orderBy?: { field: string; dir?: "asc" | "desc" };
  limit?: number;
  cursor?: string;
}

const toDoc = (row: typeof schema.appRecord.$inferSelect): Doc => ({
  id: row.id,
  userId: row.userId,
  username: row.username,
  worldVerified: row.worldVerified,
  createdAt: row.createdAt,
  data: row.data,
});

export const createDataService = ({ db }: { db: Database }) => ({
  async insert(
    appId: AppId,
    by: Stamp,
    collection: string,
    doc: Record<string, unknown>
  ): Promise<{ id: RecordId; createdAt: Date }> {
    assertName(collection);
    assertSize(doc, DOC_MAX_BYTES, "doc");
    const counted = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(appRecord)
      .where(eq(appRecord.appId, appId));
    if ((counted[0]?.c ?? 0) >= RECORDS_MAX_PER_APP) {
      throw new ORPCError("QUOTA_EXCEEDED", {
        message: `Collection storage limited to ${RECORDS_MAX_PER_APP} docs/app`,
      });
    }
    const [created] = await db
      .insert(appRecord)
      .values({
        appId,
        collection,
        userId: by.id,
        username: by.username,
        worldVerified: by.worldVerified,
        data: doc,
      })
      .returning({ id: appRecord.id, createdAt: appRecord.createdAt });
    if (!created) {
      throw new ORPCError("INTERNAL", { message: "insert failed" });
    }
    return created;
  },

  async get(
    appId: AppId,
    collection: string,
    id: RecordId
  ): Promise<Doc | null> {
    const row = await db.query.appRecord.findFirst({
      where: and(
        eq(appRecord.appId, appId),
        eq(appRecord.collection, collection),
        eq(appRecord.id, id)
      ),
    });
    return row ? toDoc(row) : null;
  },

  async update(
    appId: AppId,
    userId: UserId,
    collection: string,
    id: RecordId,
    patch: Record<string, unknown>
  ): Promise<Doc> {
    const row = await db.query.appRecord.findFirst({
      where: and(
        eq(appRecord.appId, appId),
        eq(appRecord.collection, collection),
        eq(appRecord.id, id)
      ),
    });
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Doc not found" });
    }
    if (row.userId !== userId) {
      throw new ORPCError("FORBIDDEN", { message: "Only your own docs" });
    }
    const merged = { ...row.data, ...patch };
    assertSize(merged, DOC_MAX_BYTES, "doc");
    const [updated] = await db
      .update(appRecord)
      .set({ data: merged })
      .where(eq(appRecord.id, id))
      .returning();
    return toDoc(updated ?? row);
  },

  async delete(
    appId: AppId,
    userId: UserId,
    collection: string,
    id: RecordId
  ): Promise<void> {
    const row = await db.query.appRecord.findFirst({
      columns: { id: true, userId: true },
      where: and(
        eq(appRecord.appId, appId),
        eq(appRecord.collection, collection),
        eq(appRecord.id, id)
      ),
    });
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Doc not found" });
    }
    if (row.userId !== userId) {
      throw new ORPCError("FORBIDDEN", { message: "Only your own docs" });
    }
    await db.delete(appRecord).where(eq(appRecord.id, id));
  },

  async list(
    appId: AppId,
    collection: string,
    opts: ListOpts = {}
  ): Promise<{ docs: Doc[]; cursor?: string }> {
    const limit = Math.min(opts.limit ?? LIST_MAX, LIST_MAX);
    const offset = decodeCursor(opts.cursor);

    let containment;
    if (opts.where) {
      const entries = Object.entries(opts.where);
      if (entries.length > 3) {
        throw new ORPCError("BAD_REQUEST", {
          message: "where supports ≤3 top-level keys",
        });
      }
      if (entries.length > 0) {
        containment = sql`${appRecord.data} @> ${JSON.stringify(opts.where)}::jsonb`;
      }
    }

    const order =
      opts.orderBy && opts.orderBy.field !== "createdAt"
        ? sql`(${appRecord.data}->>${opts.orderBy.field})::numeric ${sql.raw(
            opts.orderBy.dir === "asc" ? "asc" : "desc"
          )} nulls last`
        : desc(appRecord.createdAt);

    const rows = await db
      .select()
      .from(appRecord)
      .where(
        and(
          eq(appRecord.appId, appId),
          eq(appRecord.collection, collection),
          containment
        )
      )
      .orderBy(order, desc(appRecord.id))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      docs: page.map(toDoc),
      cursor: hasMore ? encodeCursor(offset + limit) : undefined,
    };
  },
});

export type DataService = ReturnType<typeof createDataService>;
