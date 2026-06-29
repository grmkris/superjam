// sdk.counter — atomic counters in the app's OWN SQLite DB (the leaderboard
// primitive, §9). increment is a single ON CONFLICT DO UPDATE (never
// read-modify-write); top is an indexed descending scan. Reserved names (_plays,
// _ai_quota…) are platform-internal — the bridge router blocks them (§7).
import { type AppDb, appData } from "@superjam/db/libsql";
import { LIST_MAX } from "@superjam/shared";
import { desc, eq, sql } from "drizzle-orm";
import { assertKey, assertName } from "../lib/validate.ts";

const { counters } = appData;

export const createCounterService = ({ db }: { db: AppDb }) => ({
  async increment(counter: string, key: string, by = 1): Promise<number> {
    assertName(counter);
    assertKey(key);
    const [row] = await db
      .insert(counters)
      .values({ counter, key, value: by })
      .onConflictDoUpdate({
        target: [counters.counter, counters.key],
        set: { value: sql`${counters.value} + ${by}` },
      })
      .returning({ value: counters.value });
    return row?.value ?? by;
  },

  async top(
    counter: string,
    limit = 10
  ): Promise<{ key: string; value: number }[]> {
    assertName(counter);
    const rows = await db
      .select({ key: counters.key, value: counters.value })
      .from(counters)
      .where(eq(counters.counter, counter))
      .orderBy(desc(counters.value))
      .limit(Math.min(limit, LIST_MAX));
    return rows.map((r) => ({ key: r.key, value: r.value }));
  },
});

export type CounterService = ReturnType<typeof createCounterService>;
