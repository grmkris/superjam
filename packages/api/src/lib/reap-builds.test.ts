import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { schema } from "@superjam/db";
import { createPgliteDb } from "@superjam/db/pglite";
import type { Database } from "@superjam/db";
import type { UserId } from "@superjam/shared";
import { createTestUser } from "../testing/factories.ts";
import { reapStaleBuilds } from "./reap-builds.ts";

// Fresh pglite + migrations per test — slow under concurrent load.
setDefaultTimeout(20_000);

const { build } = schema;
const HOUR = 60 * 60 * 1000;
const THRESHOLD = 20 * 60 * 1000;

// Insert a build with a controllable updatedAt ($onUpdate only fires on UPDATE,
// so an explicit insert value sticks — lets us simulate a quiet/orphaned build).
const seedBuild = async (
  db: Database,
  userId: UserId,
  over: Partial<typeof schema.build.$inferInsert> = {}
) => {
  const [b] = await db
    .insert(build)
    .values({ userId, prompt: "p", status: "generating", ...over })
    .returning();
  return b!;
};

describe("reapStaleBuilds", () => {
  test("fails stale non-terminal builds; spares fresh + terminal", async () => {
    const { db } = await createPgliteDb();
    const user = await createTestUser(db);
    const old = new Date(Date.now() - HOUR);
    const stale = await seedBuild(db, user.id, { updatedAt: old, createdAt: old });
    const fresh = await seedBuild(db, user.id); // updatedAt defaults to now
    const done = await seedBuild(db, user.id, {
      status: "done",
      updatedAt: old,
      createdAt: old,
    });

    const n = await reapStaleBuilds(db, { olderThanMs: THRESHOLD });
    expect(n).toBe(1);

    const rows = await db.select().from(build);
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status[stale.id]).toBe("failed");
    expect(status[fresh.id]).toBe("generating");
    expect(status[done.id]).toBe("done");
  });

  test("scopes to userId when given", async () => {
    const { db } = await createPgliteDb();
    const a = await createTestUser(db);
    const b = await createTestUser(db);
    const old = new Date(Date.now() - HOUR);
    const sa = await seedBuild(db, a.id, { updatedAt: old, createdAt: old });
    const sb = await seedBuild(db, b.id, { updatedAt: old, createdAt: old });

    const n = await reapStaleBuilds(db, { userId: a.id, olderThanMs: THRESHOLD });
    expect(n).toBe(1);

    const rows = await db.select().from(build);
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status[sa.id]).toBe("failed");
    expect(status[sb.id]).toBe("generating");
  });
});
