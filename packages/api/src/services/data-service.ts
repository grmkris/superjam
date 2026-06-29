// sdk.data — app-public shared collections in the app's OWN SQLite DB (§9).
// Identity is server-stamped; update/delete are OWN-rows-only. where = top-level
// equality (≤3 keys) via json_extract; orderBy = createdAt | a numeric data field.
// (The DB is the app's, so there is no appId scoping.)
import { type AppDb, appData } from "@superjam/db/libsql";
import {
  DOC_MAX_BYTES,
  LIST_MAX,
  RECORDS_MAX_PER_APP,
  type RecordId,
  type UserId,
} from "@superjam/shared";
import { typeIdGenerator } from "@superjam/shared/typeid";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import { assertName, assertSize } from "../lib/validate.ts";

const { records } = appData;

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

const toDoc = (row: typeof records.$inferSelect): Doc => ({
  id: row.id as RecordId,
  userId: row.userId as UserId,
  username: row.username,
  worldVerified: row.worldVerified,
  createdAt: row.createdAt,
  data: row.data,
});

export const createDataService = ({ db }: { db: AppDb }) => ({
  async insert(
    by: Stamp,
    collection: string,
    doc: Record<string, unknown>
  ): Promise<{ id: RecordId; createdAt: Date }> {
    assertName(collection);
    assertSize(doc, DOC_MAX_BYTES, "doc");
    const counted = await db.select({ c: sql<number>`count(*)` }).from(records);
    if ((counted[0]?.c ?? 0) >= RECORDS_MAX_PER_APP) {
      throw new ORPCError("QUOTA_EXCEEDED", {
        message: `Collection storage limited to ${RECORDS_MAX_PER_APP} docs/app`,
      });
    }
    const id = typeIdGenerator("record");
    const createdAt = new Date();
    await db.insert(records).values({
      id,
      collection,
      userId: by.id,
      username: by.username,
      worldVerified: by.worldVerified,
      data: doc,
      createdAt,
    });
    return { id, createdAt };
  },

  async get(collection: string, id: RecordId): Promise<Doc | null> {
    const row = await db.query.records.findFirst({
      where: and(eq(records.collection, collection), eq(records.id, id)),
    });
    return row ? toDoc(row) : null;
  },

  async update(
    userId: UserId,
    collection: string,
    id: RecordId,
    patch: Record<string, unknown>
  ): Promise<Doc> {
    const row = await db.query.records.findFirst({
      where: and(eq(records.collection, collection), eq(records.id, id)),
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
      .update(records)
      .set({ data: merged, updatedAt: new Date() })
      .where(eq(records.id, id))
      .returning();
    return toDoc(updated ?? row);
  },

  async delete(
    userId: UserId,
    collection: string,
    id: RecordId
  ): Promise<void> {
    const row = await db.query.records.findFirst({
      columns: { id: true, userId: true },
      where: and(eq(records.collection, collection), eq(records.id, id)),
    });
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Doc not found" });
    }
    if (row.userId !== userId) {
      throw new ORPCError("FORBIDDEN", { message: "Only your own docs" });
    }
    await db.delete(records).where(eq(records.id, id));
  },

  async list(
    collection: string,
    opts: ListOpts = {}
  ): Promise<{ docs: Doc[]; cursor?: string }> {
    const limit = Math.min(opts.limit ?? LIST_MAX, LIST_MAX);
    const offset = decodeCursor(opts.cursor);

    const conds = [eq(records.collection, collection)];
    if (opts.where) {
      const entries = Object.entries(opts.where);
      if (entries.length > 3) {
        throw new ORPCError("BAD_REQUEST", {
          message: "where supports ≤3 top-level keys",
        });
      }
      for (const [k, v] of entries) {
        conds.push(
          sql`json_extract(${records.data}, ${`$.${k}`}) = ${v as string | number}`
        );
      }
    }

    const order =
      opts.orderBy && opts.orderBy.field !== "createdAt"
        ? sql`cast(json_extract(${records.data}, ${`$.${opts.orderBy.field}`}) as real) ${sql.raw(
            opts.orderBy.dir === "asc" ? "asc" : "desc"
          )}`
        : desc(records.createdAt);

    const rows = await db
      .select()
      .from(records)
      .where(and(...conds))
      .orderBy(order, desc(records.id))
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
