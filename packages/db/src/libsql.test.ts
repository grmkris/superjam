import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { appData, bindAppDb, ensureAppTables } from "./libsql.ts";

describe("per-app libSQL binding", () => {
  test("ensureAppTables + records/counters/storage round-trip", async () => {
    const { db, client } = bindAppDb({ dbUrl: ":memory:" });
    await ensureAppTables(client);
    // idempotent
    await ensureAppTables(client);

    // records — json data, boolean, server-stamped identity, default createdAt
    await db.insert(appData.records).values({
      id: "r1",
      collection: "posts",
      userId: "u1",
      username: "alice",
      worldVerified: true,
      data: { body: "hi" },
    });
    const recs = await db
      .select()
      .from(appData.records)
      .where(eq(appData.records.collection, "posts"));
    expect(recs).toHaveLength(1);
    expect(recs[0]?.data).toEqual({ body: "hi" });
    expect(recs[0]?.worldVerified).toBe(true);
    expect(recs[0]?.createdAt).toBeInstanceOf(Date);

    // counters — atomic ON CONFLICT increment
    const bump = () =>
      db
        .insert(appData.counters)
        .values({ counter: "scores", key: "alice", value: 5 })
        .onConflictDoUpdate({
          target: [appData.counters.counter, appData.counters.key],
          set: { value: sql`${appData.counters.value} + 5` },
        });
    await bump();
    await bump();
    const c = await db
      .select()
      .from(appData.counters)
      .where(eq(appData.counters.key, "alice"));
    expect(c[0]?.value).toBe(10);

    // storage — per-user json KV
    await db
      .insert(appData.storage)
      .values({ userId: "u1", key: "k", value: { a: 1 } });
    const s = await db.select().from(appData.storage);
    expect(s[0]?.value).toEqual({ a: 1 });

    client.close();
  });
});
