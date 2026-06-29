import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  appData,
  bindAppDb,
  createTursoClient,
  ensureAppTables,
  tursoDbNameFor,
} from "./libsql.ts";

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

interface StubRes {
  ok?: boolean;
  status?: number;
  json?: unknown;
}
const stubFetch = (responses: StubRes[]) => {
  const calls: { url: string; method?: string }[] = [];
  let i = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const r = responses[i++] ?? { ok: true, json: {} };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json ?? {},
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe("createTursoClient", () => {
  test("ensureDatabase returns the libsql URL on create", async () => {
    const { impl } = stubFetch([
      { json: { database: { Hostname: "sj-x-grmkris.turso.io" } } },
    ]);
    const t = createTursoClient({ apiToken: "k", org: "grmkris", fetchImpl: impl });
    expect(await t.ensureDatabase("sj-x")).toEqual({
      dbUrl: "libsql://sj-x-grmkris.turso.io",
    });
  });

  test("ensureDatabase falls back to GET on 409 (already exists)", async () => {
    const { impl, calls } = stubFetch([
      { ok: false, status: 409 },
      { json: { database: { Hostname: "sj-x-grmkris.turso.io" } } },
    ]);
    const t = createTursoClient({ apiToken: "k", org: "grmkris", fetchImpl: impl });
    expect(await t.ensureDatabase("sj-x")).toEqual({
      dbUrl: "libsql://sj-x-grmkris.turso.io",
    });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[1]?.method).toBe("GET");
  });

  test("mintToken returns the jwt", async () => {
    const { impl } = stubFetch([{ json: { jwt: "tok-abc" } }]);
    const t = createTursoClient({ apiToken: "k", org: "o", fetchImpl: impl });
    expect(await t.mintToken("sj-x")).toBe("tok-abc");
  });

  test("deleteDatabase treats 404 as success (idempotent)", async () => {
    const { impl } = stubFetch([{ ok: false, status: 404 }]);
    const t = createTursoClient({ apiToken: "k", org: "o", fetchImpl: impl });
    await expect(t.deleteDatabase("gone")).resolves.toBeUndefined();
  });
});

describe("tursoDbNameFor", () => {
  test("is dns-safe, lowercased, bounded", () => {
    expect(tursoDbNameFor("App_123")).toBe("sj-app-123");
    expect(tursoDbNameFor("a".repeat(100)).length).toBeLessThanOrEqual(58);
  });
});
