import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Database, schema } from "@superjam/db";
import {
  type AppDb,
  type BoundAppDb,
  appData,
  bindAppDb,
  ensureAppTables,
} from "@superjam/db/libsql";
import type { UserId } from "@superjam/shared";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import { createCounterService } from "./counter-service.ts";
import { createDataService } from "./data-service.ts";
import { createMessageService } from "./message-service.ts";
import { createStorageService } from "./storage-service.ts";

const { appMessage } = schema;
const uid = (s: string) => s as UserId;
const alice = uid("user_alice");
const bob = uid("user_bob");

// --- per-app data plane (libSQL, in-memory) — storage / data / counter ---
// Each app's data lives in its OWN SQLite DB; identity (userId) is server-stamped.
describe("storage (per-app libSQL)", () => {
  let db: AppDb;
  let client: BoundAppDb["client"];
  beforeEach(async () => {
    ({ db, client } = bindAppDb({ dbUrl: ":memory:" }));
    await ensureAppTables(client);
  });
  afterEach(() => {
    client.close();
  });

  test("roundtrip get/set/delete/clear", async () => {
    const svc = createStorageService({ db });
    expect(await svc.get(alice, "k")).toBeNull();
    await svc.set(alice, "k", { v: 1 });
    expect(await svc.get(alice, "k")).toEqual({ v: 1 });
    await svc.delete(alice, "k");
    expect(await svc.get(alice, "k")).toBeNull();
    await svc.set(alice, "a", 1);
    await svc.set(alice, "b", 2);
    await svc.clear(alice);
    expect((await svc.list(alice)).keys).toEqual([]);
  });

  test("1001st key fails; existing key still settable at cap", async () => {
    const svc = createStorageService({ db });
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      userId: alice,
      key: `k${i}`,
      value: i,
    }));
    await db.insert(appData.storage).values(rows);
    await expect(svc.set(alice, "k1000", 1)).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    await svc.set(alice, "k0", 999); // overwrite is fine at cap
    expect(await svc.get(alice, "k0")).toBe(999);
  });

  test("list prefix + cursor pages", async () => {
    const svc = createStorageService({ db });
    for (const k of ["a", "b", "c", "d"]) {
      await svc.set(alice, k, 1);
    }
    const p1 = await svc.list(alice, { limit: 2 });
    expect(p1.keys).toEqual(["a", "b"]);
    expect(p1.cursor).toBeDefined();
    const p2 = await svc.list(alice, { limit: 2, cursor: p1.cursor });
    expect(p2.keys).toEqual(["c", "d"]);
    expect(p2.cursor).toBeUndefined();
  });

  test("get is per-user isolated", async () => {
    const svc = createStorageService({ db });
    await svc.set(alice, "k", "mine");
    expect(await svc.get(bob, "k")).toBeNull();
  });
});

describe("data (per-app libSQL, shared collections)", () => {
  let db: AppDb;
  let client: BoundAppDb["client"];
  beforeEach(async () => {
    ({ db, client } = bindAppDb({ dbUrl: ":memory:" }));
    await ensureAppTables(client);
  });
  afterEach(() => {
    client.close();
  });

  const by = (id: UserId) => ({ id, username: "alice", worldVerified: false });

  test("insert stamps identity; update/delete OWN rows only", async () => {
    const svc = createDataService({ db });
    const { id } = await svc.insert(by(alice), "posts", { body: "hi" });
    const doc = await svc.get("posts", id);
    expect(doc?.username).toBe("alice");
    expect(doc?.userId).toBe(alice);

    await expect(
      svc.update(bob, "posts", id, { body: "hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.delete(bob, "posts", id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const updated = await svc.update(alice, "posts", id, { body: "edited" });
    expect(updated.data.body).toBe("edited");
    await svc.delete(alice, "posts", id);
    expect(await svc.get("posts", id)).toBeNull();
  });

  test("list where filters by top-level equality", async () => {
    const svc = createDataService({ db });
    await svc.insert(by(alice), "plays", { team: "red", score: 5 });
    await svc.insert(by(alice), "plays", { team: "blue", score: 9 });
    const red = await svc.list("plays", { where: { team: "red" } });
    expect(red.docs).toHaveLength(1);
    expect(red.docs[0]?.data.team).toBe("red");
  });

  test("list orderBy a numeric data field", async () => {
    const svc = createDataService({ db });
    await svc.insert(by(alice), "plays", { score: 5 });
    await svc.insert(by(alice), "plays", { score: 9 });
    await svc.insert(by(alice), "plays", { score: 1 });
    const top = await svc.list("plays", {
      orderBy: { field: "score", dir: "desc" },
    });
    expect(top.docs.map((d) => d.data.score)).toEqual([9, 5, 1]);
  });
});

describe("counter (per-app libSQL)", () => {
  let db: AppDb;
  let client: BoundAppDb["client"];
  beforeEach(async () => {
    ({ db, client } = bindAppDb({ dbUrl: ":memory:" }));
    await ensureAppTables(client);
  });
  afterEach(() => {
    client.close();
  });

  test("increments accumulate atomically (+2)", async () => {
    const svc = createCounterService({ db });
    await svc.increment("scores", "alice", 1);
    await svc.increment("scores", "alice", 1);
    expect(await svc.top("scores")).toEqual([{ key: "alice", value: 2 }]);
  });

  test("top is descending", async () => {
    const svc = createCounterService({ db });
    await svc.increment("scores", "a", 3);
    await svc.increment("scores", "b", 7);
    await svc.increment("scores", "c", 5);
    const top = await svc.top("scores", 2);
    expect(top.map((t) => t.key)).toEqual(["b", "c"]);
  });
});

// --- platform DB (pglite) — messages (unchanged: uses the shared platform DB) ---
describe("messages", () => {
  let db: Database;
  beforeEach(async () => {
    ({ db } = await (await import("@superjam/db/pglite")).createPgliteDb());
  });
  const from = (u: { id: UserId; username: string }) => ({
    id: u.id,
    username: u.username,
  });
  const msgScope = async () => {
    const sender = await createTestUser(db);
    const recipient = await createTestUser(db);
    const app = await createTestApp(db, sender.id);
    const svc = createMessageService({ db, rateLimiter: createRateLimiter() });
    return { sender, recipient, appId: app.id, svc };
  };

  test("rejects self-send and unknown recipient", async () => {
    const { sender, appId, svc } = await msgScope();
    await expect(
      svc.send(appId, from(sender), { to: sender.username, text: "yo" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      svc.send(appId, from(sender), { to: "ghost", text: "yo" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("6th message to the same pair → RATE_LIMITED", async () => {
    const { sender, recipient, appId, svc } = await msgScope();
    for (let i = 0; i < 5; i += 1) {
      await svc.send(appId, from(sender), { to: recipient.username, text: "hi" });
    }
    await expect(
      svc.send(appId, from(sender), { to: recipient.username, text: "hi" })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  test("link validation: external rejected, platform path normalized", async () => {
    const { sender, recipient, appId, svc } = await msgScope();
    await expect(
      svc.send(appId, from(sender), {
        to: recipient.username,
        text: "x",
        link: "https://evil.com/app/foo",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await svc.send(appId, from(sender), {
      to: recipient.username,
      text: "x",
      link: "https://superjam.fun/app/foo?d=abc",
    });
    const row = await db.query.appMessage.findFirst({
      where: eq(appMessage.toUserId, recipient.id),
    });
    expect(row?.link).toBe("/app/foo?d=abc");
  });

  test("inbox list + markRead", async () => {
    const { sender, recipient, appId, svc } = await msgScope();
    await svc.send(appId, from(sender), { to: recipient.username, text: "one" });
    const inbox = await svc.inbox(recipient.id);
    expect(inbox.unread).toBe(1);
    expect(inbox.messages[0]?.from.username).toBe(sender.username);
    await svc.markAllRead(recipient.id);
    expect((await svc.inbox(recipient.id)).unread).toBe(0);
  });
});
