// sdk.storage — user-private KV in the app's OWN SQLite DB (§9). Server stamps the
// userId; the iframe never supplies identity. Quotas: ≤1000 keys/user, value ≤64KiB.
import { type AppDb, appData } from "@superjam/db/libsql";
import {
  LIST_MAX,
  STORAGE_MAX_KEYS,
  STORAGE_VALUE_MAX_BYTES,
  type UserId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, inArray, like, sql } from "drizzle-orm";
import { assertKey, assertSize } from "../lib/validate.ts";

const { storage } = appData;

export interface ListOpts {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export const createStorageService = ({ db }: { db: AppDb }) => {
  const scope = (userId: UserId) => eq(storage.userId, userId);

  return {
    async get(userId: UserId, key: string): Promise<unknown> {
      assertKey(key);
      const row = await db.query.storage.findFirst({
        where: and(scope(userId), eq(storage.key, key)),
      });
      return row?.value ?? null;
    },

    async getMany(
      userId: UserId,
      keys: string[]
    ): Promise<Record<string, unknown>> {
      for (const k of keys) {
        assertKey(k);
      }
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        out[k] = null;
      }
      if (keys.length === 0) {
        return out;
      }
      const rows = await db
        .select({ key: storage.key, value: storage.value })
        .from(storage)
        .where(and(scope(userId), inArray(storage.key, keys)));
      for (const r of rows) {
        out[r.key] = r.value ?? null;
      }
      return out;
    },

    async set(userId: UserId, key: string, value: unknown): Promise<void> {
      assertKey(key);
      assertSize(value, STORAGE_VALUE_MAX_BYTES, "value");
      const existing = await db.query.storage.findFirst({
        columns: { key: true },
        where: and(scope(userId), eq(storage.key, key)),
      });
      if (!existing) {
        const counted = await db
          .select({ c: sql<number>`count(*)` })
          .from(storage)
          .where(scope(userId));
        if ((counted[0]?.c ?? 0) >= STORAGE_MAX_KEYS) {
          throw new ORPCError("QUOTA_EXCEEDED", {
            message: `Storage limited to ${STORAGE_MAX_KEYS} keys`,
          });
        }
      }
      await db
        .insert(storage)
        .values({ userId, key, value })
        .onConflictDoUpdate({
          target: [storage.userId, storage.key],
          set: { value, updatedAt: new Date() },
        });
    },

    async delete(userId: UserId, key: string): Promise<void> {
      assertKey(key);
      await db.delete(storage).where(and(scope(userId), eq(storage.key, key)));
    },

    async clear(userId: UserId): Promise<void> {
      await db.delete(storage).where(scope(userId));
    },

    async list(
      userId: UserId,
      opts: ListOpts = {}
    ): Promise<{ keys: string[]; cursor?: string }> {
      const limit = Math.min(opts.limit ?? LIST_MAX, LIST_MAX);
      const rows = await db
        .select({ key: storage.key })
        .from(storage)
        .where(
          and(
            scope(userId),
            opts.prefix ? like(storage.key, `${opts.prefix}%`) : undefined,
            opts.cursor ? gt(storage.key, opts.cursor) : undefined
          )
        )
        .orderBy(asc(storage.key))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        keys: page.map((r) => r.key),
        cursor: hasMore ? page.at(-1)?.key : undefined,
      };
    },
  };
};

export type StorageService = ReturnType<typeof createStorageService>;
