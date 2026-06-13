import { beforeEach, describe, expect, test } from "bun:test";
import { createPgliteDb } from "@superjam/db/pglite";
import { schema } from "@superjam/db";
import { eq } from "drizzle-orm";
import type { Database } from "@superjam/db";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import { createCounterService } from "./counter-service.ts";
import { createDataService } from "./data-service.ts";
import { createMessageService } from "./message-service.ts";
import { createStorageService } from "./storage-service.ts";

const { appStorage, appMessage } = schema;

let db: Database;
beforeEach(async () => {
  ({ db } = await createPgliteDb());
});

const from = (u: { id: any; username: string }) => ({
  id: u.id,
  username: u.username,
});

const scope = async () => {
  const owner = await createTestUser(db);
  const app = await createTestApp(db, owner.id);
  return { owner, appId: app.id };
};

describe("storage", () => {
  test("roundtrip get/set/delete/clear", async () => {
    const { owner, appId } = await scope();
    const svc = createStorageService({ db });
    expect(await svc.get(appId, owner.id, "k")).toBeNull();
    await svc.set(appId, owner.id, "k", { v: 1 });
    expect(await svc.get(appId, owner.id, "k")).toEqual({ v: 1 });
    await svc.delete(appId, owner.id, "k");
    expect(await svc.get(appId, owner.id, "k")).toBeNull();
    await svc.set(appId, owner.id, "a", 1);
    await svc.set(appId, owner.id, "b", 2);
    await svc.clear(appId, owner.id);
    expect((await svc.list(appId, owner.id)).keys).toEqual([]);
  });

  test("1001st key fails; existing key still settable at cap", async () => {
    const { owner, appId } = await scope();
    const svc = createStorageService({ db });
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      appId,
      userId: owner.id,
      key: `k${i}`,
      value: i,
    }));
    await db.insert(appStorage).values(rows);
    await expect(svc.set(appId, owner.id, "k1000", 1)).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    await svc.set(appId, owner.id, "k0", 999); // overwrite is fine at cap
    expect(await svc.get(appId, owner.id, "k0")).toBe(999);
  });

  test("list prefix + cursor pages", async () => {
    const { owner, appId } = await scope();
    const svc = createStorageService({ db });
    for (const k of ["a", "b", "c", "d"]) {
      await svc.set(appId, owner.id, k, 1);
    }
    const p1 = await svc.list(appId, owner.id, { limit: 2 });
    expect(p1.keys).toEqual(["a", "b"]);
    expect(p1.cursor).toBeDefined();
    const p2 = await svc.list(appId, owner.id, { limit: 2, cursor: p1.cursor });
    expect(p2.keys).toEqual(["c", "d"]);
    expect(p2.cursor).toBeUndefined();
  });

  test("get is per-user isolated", async () => {
    const { owner, appId } = await scope();
    const other = await createTestUser(db);
    const svc = createStorageService({ db });
    await svc.set(appId, owner.id, "k", "mine");
    expect(await svc.get(appId, other.id, "k")).toBeNull();
  });
});

describe("data (shared collections)", () => {
  test("insert stamps identity; update/delete OWN rows only", async () => {
    const { owner, appId } = await scope();
    const other = await createTestUser(db, { worldVerified: true });
    const svc = createDataService({ db });
    const { id } = await svc.insert(
      appId,
      { id: owner.id, username: owner.username, worldVerified: false },
      "posts",
      { body: "hi" }
    );
    const doc = await svc.get(appId, "posts", id);
    expect(doc?.username).toBe(owner.username);
    expect(doc?.userId).toBe(owner.id);

    await expect(
      svc.update(appId, other.id, "posts", id, { body: "hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      svc.delete(appId, other.id, "posts", id)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const updated = await svc.update(appId, owner.id, "posts", id, {
      body: "edited",
    });
    expect(updated.data.body).toBe("edited");
    await svc.delete(appId, owner.id, "posts", id);
    expect(await svc.get(appId, "posts", id)).toBeNull();
  });

  test("list where containment filters by top-level equality", async () => {
    const { owner, appId } = await scope();
    const svc = createDataService({ db });
    const by = { id: owner.id, username: owner.username, worldVerified: false };
    await svc.insert(appId, by, "plays", { team: "red", score: 5 });
    await svc.insert(appId, by, "plays", { team: "blue", score: 9 });
    const red = await svc.list(appId, "plays", { where: { team: "red" } });
    expect(red.docs).toHaveLength(1);
    expect(red.docs[0]?.data.team).toBe("red");
  });

  test("list orderBy a numeric data field", async () => {
    const { owner, appId } = await scope();
    const svc = createDataService({ db });
    const by = { id: owner.id, username: owner.username, worldVerified: false };
    await svc.insert(appId, by, "plays", { score: 5 });
    await svc.insert(appId, by, "plays", { score: 9 });
    await svc.insert(appId, by, "plays", { score: 1 });
    const top = await svc.list(appId, "plays", {
      orderBy: { field: "score", dir: "desc" },
    });
    expect(top.docs.map((d) => d.data.score)).toEqual([9, 5, 1]);
  });
});

describe("counter", () => {
  test("parallel increments are atomic (+2)", async () => {
    const { appId } = await scope();
    const svc = createCounterService({ db });
    await Promise.all([
      svc.increment(appId, "scores", "alice", 1),
      svc.increment(appId, "scores", "alice", 1),
    ]);
    const top = await svc.top(appId, "scores");
    expect(top).toEqual([{ key: "alice", value: 2 }]);
  });

  test("top is descending", async () => {
    const { appId } = await scope();
    const svc = createCounterService({ db });
    await svc.increment(appId, "scores", "a", 3);
    await svc.increment(appId, "scores", "b", 7);
    await svc.increment(appId, "scores", "c", 5);
    const top = await svc.top(appId, "scores", 2);
    expect(top.map((t) => t.key)).toEqual(["b", "c"]);
  });
});

describe("messages", () => {
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

  test("eviction at INBOX_CAP removes the oldest READ first", async () => {
    const { sender, recipient, appId, svc } = await msgScope();
    // 200 messages, oldest (i=0) UNREAD, the next-oldest (i=1) READ.
    const base = Date.now() - 1_000_000;
    const rows = Array.from({ length: 200 }, (_, i) => ({
      appId,
      fromUserId: sender.id,
      toUserId: recipient.id,
      text: `m${i}`,
      read: i === 1,
      createdAt: new Date(base + i * 1000),
    }));
    const inserted = await db
      .insert(appMessage)
      .values(rows)
      .returning({ id: appMessage.id, text: appMessage.text });
    const oldestUnread = inserted.find((r) => r.text === "m0")!;
    const oldestRead = inserted.find((r) => r.text === "m1")!;

    // 201st send triggers eviction of exactly one row.
    await svc.send(appId, from(sender), { to: recipient.username, text: "new" });

    const stillThere = async (id: typeof oldestRead.id) =>
      Boolean(
        await db.query.appMessage.findFirst({ where: eq(appMessage.id, id) })
      );
    expect(await stillThere(oldestRead.id)).toBe(false); // oldest READ evicted
    expect(await stillThere(oldestUnread.id)).toBe(true); // older UNREAD kept
  });
});
