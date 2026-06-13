// sdk.counter — atomic counters, the leaderboard primitive (§9). increment is a
// single ON CONFLICT DO UPDATE (never read-modify-write); top is an indexed
// descending scan. Reserved names (_plays, _ai_quota…) are platform-internal —
// the bridge router blocks them from app callers (§7).
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { type AppId, LIST_MAX } from "@superjam/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { assertKey, assertName } from "../lib/validate.ts";

const { appCounter } = schema;

export const createCounterService = ({ db }: { db: Database }) => ({
  async increment(
    appId: AppId,
    counter: string,
    key: string,
    by = 1
  ): Promise<number> {
    assertName(counter);
    assertKey(key);
    const [row] = await db
      .insert(appCounter)
      .values({ appId, counter, key, value: BigInt(by) })
      .onConflictDoUpdate({
        target: [appCounter.appId, appCounter.counter, appCounter.key],
        set: { value: sql`${appCounter.value} + ${by}` },
      })
      .returning({ value: appCounter.value });
    return Number(row?.value ?? by);
  },

  async top(
    appId: AppId,
    counter: string,
    limit = 10
  ): Promise<{ key: string; value: number }[]> {
    assertName(counter);
    const rows = await db
      .select({ key: appCounter.key, value: appCounter.value })
      .from(appCounter)
      .where(and(eq(appCounter.appId, appId), eq(appCounter.counter, counter)))
      .orderBy(desc(appCounter.value))
      .limit(Math.min(limit, LIST_MAX));
    return rows.map((r) => ({ key: r.key, value: Number(r.value) }));
  },
});

export type CounterService = ReturnType<typeof createCounterService>;
