import { describe, expect, test } from "bun:test";
import { createPgliteDb } from "@superjam/db/pglite";
import { schema } from "@superjam/db";
import { createTestApp, createTestUser } from "@superjam/api/testing";
import { createLogger } from "@superjam/logger";
import { PLAYS_COUNTER } from "@superjam/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMemoryStore } from "./bucket.ts";
import { registerServeRoutes } from "./serve.ts";

const { appCounter } = schema;
const logger = createLogger({ level: "silent" });

const harness = async () => {
  const { db } = await createPgliteDb();
  const store = createMemoryStore();
  const owner = await createTestUser(db);
  const app = await createTestApp(db, owner.id, {
    slug: "tipjar",
    iconEmoji: "🫙",
    bundleKey: "apps/app1/bld1",
  });
  await store.put("apps/app1/bld1/index.html", "<h1>hi</h1>", "text/html");
  await store.put("apps/app1/bld1/main.js", "console.log(1)", "text/javascript");
  const hono = new Hono();
  registerServeRoutes(hono, { db, store, logger });
  return { db, hono, appId: app.id };
};

const playsTotal = async (db: Awaited<ReturnType<typeof harness>>["db"], appId: string) => {
  const row = await db.query.appCounter.findFirst({
    where: and(
      eq(appCounter.appId, appId as never),
      eq(appCounter.counter, PLAYS_COUNTER),
      eq(appCounter.key, "total")
    ),
  });
  return row ? Number(row.value) : 0;
};

describe("/a serving", () => {
  test("serves index.html no-cache and bumps _plays", async () => {
    const { db, hono, appId } = await harness();
    const res = await hono.request("/a/tipjar");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>hi</h1>");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(await playsTotal(db, appId)).toBe(1);
    // a second load bumps again
    await hono.request("/a/tipjar");
    expect(await playsTotal(db, appId)).toBe(2);
  });

  test("serves assets immutable, correct MIME", async () => {
    const { hono } = await harness();
    const res = await hono.request("/a/tipjar/main.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  test("icon.svg renders the manifest emoji", async () => {
    const { hono } = await harness();
    const res = await hono.request("/a/tipjar/icon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("🫙");
  });

  test("rejects path traversal", async () => {
    const { hono } = await harness();
    const res = await hono.request("/a/tipjar/..%2f..%2fsecret");
    expect(res.status).toBe(400);
  });

  test("404 for unknown slug and missing asset", async () => {
    const { hono } = await harness();
    expect((await hono.request("/a/ghost")).status).toBe(404);
    expect((await hono.request("/a/tipjar/missing.js")).status).toBe(404);
  });
});
