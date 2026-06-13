// sdk.storage — user-private KV (§9). Server stamps (appId, userId); the iframe
// never supplies identity. Quotas: ≤1000 keys/user/app, value ≤64KiB (§7).
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppId,
  LIST_MAX,
  STORAGE_MAX_KEYS,
  STORAGE_VALUE_MAX_BYTES,
  type UserId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, inArray, like, sql } from "drizzle-orm";
import { assertKey, assertSize } from "../lib/validate.ts";

const { appStorage } = schema;

export interface ListOpts {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export const createStorageService = ({ db }: { db: Database }) => {
  const scope = (appId: AppId, userId: UserId) =>
    and(eq(appStorage.appId, appId), eq(appStorage.userId, userId));

  return {
    async get(appId: AppId, userId: UserId, key: string): Promise<unknown> {
      assertKey(key);
      const row = await db.query.appStorage.findFirst({
        where: and(scope(appId, userId), eq(appStorage.key, key)),
      });
      return row?.value ?? null;
    },

    async getMany(
      appId: AppId,
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
        .select({ key: appStorage.key, value: appStorage.value })
        .from(appStorage)
        .where(and(scope(appId, userId), inArray(appStorage.key, keys)));
      for (const r of rows) {
        out[r.key] = r.value ?? null;
      }
      return out;
    },

    async set(
      appId: AppId,
      userId: UserId,
      key: string,
      value: unknown
    ): Promise<void> {
      assertKey(key);
      assertSize(value, STORAGE_VALUE_MAX_BYTES, "value");
      const existing = await db.query.appStorage.findFirst({
        columns: { key: true },
        where: and(scope(appId, userId), eq(appStorage.key, key)),
      });
      if (!existing) {
        const counted = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(appStorage)
          .where(scope(appId, userId));
        if ((counted[0]?.c ?? 0) >= STORAGE_MAX_KEYS) {
          throw new ORPCError("QUOTA_EXCEEDED", {
            message: `Storage limited to ${STORAGE_MAX_KEYS} keys`,
          });
        }
      }
      await db
        .insert(appStorage)
        .values({ appId, userId, key, value })
        .onConflictDoUpdate({
          target: [appStorage.appId, appStorage.userId, appStorage.key],
          set: { value, updatedAt: new Date() },
        });
    },

    async delete(appId: AppId, userId: UserId, key: string): Promise<void> {
      assertKey(key);
      await db
        .delete(appStorage)
        .where(and(scope(appId, userId), eq(appStorage.key, key)));
    },

    async clear(appId: AppId, userId: UserId): Promise<void> {
      await db.delete(appStorage).where(scope(appId, userId));
    },

    async list(
      appId: AppId,
      userId: UserId,
      opts: ListOpts = {}
    ): Promise<{ keys: string[]; cursor?: string }> {
      const limit = Math.min(opts.limit ?? LIST_MAX, LIST_MAX);
      const rows = await db
        .select({ key: appStorage.key })
        .from(appStorage)
        .where(
          and(
            scope(appId, userId),
            opts.prefix ? like(appStorage.key, `${opts.prefix}%`) : undefined,
            opts.cursor ? gt(appStorage.key, opts.cursor) : undefined
          )
        )
        .orderBy(asc(appStorage.key))
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
