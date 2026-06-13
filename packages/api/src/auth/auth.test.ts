import { describe, expect, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import { createContext } from "../context.ts";
import { appRouter } from "../router.ts";
import { createTestAuth } from "./test-auth.ts";

const logger = createLogger({ level: "silent" });

const harness = async () => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const ctxFor = (token?: string) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    });
  return { db, auth, ctxFor };
};

describe("health", () => {
  test("public, no auth", async () => {
    const { ctxFor } = await harness();
    expect(await call(appRouter.health, undefined, { context: ctxFor() })).toBe(
      "OK"
    );
  });
});

describe("auth middleware (profile.me)", () => {
  test("rejects a missing token", async () => {
    const { ctxFor } = await harness();
    expect(
      call(appRouter.profile.me, undefined, { context: ctxFor() })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("rejects a garbage token", async () => {
    const { ctxFor } = await harness();
    await expect(
      call(appRouter.profile.me, undefined, { context: ctxFor("not.a.jwt") })
    ).rejects.toBeInstanceOf(ORPCError);
  });

  test("verifies a valid token and upserts the user", async () => {
    const { auth, ctxFor } = await harness();
    const token = await auth.sign({
      dynamicUserId: "dyn_1",
      email: "alice@example.com",
      walletAddress: "0xABCDEF0000000000000000000000000000000001",
    });
    const me = await call(appRouter.profile.me, undefined, {
      context: ctxFor(token),
    });
    expect(me.username).toBe("alice");
    expect(me.email).toBe("alice@example.com");
    expect(me.walletAddress).toBe(
      "0xabcdef0000000000000000000000000000000001"
    );
    expect(me.worldVerified).toBe(false);
  });

  test("same dynamic user → no duplicate account", async () => {
    const { db, auth, ctxFor } = await harness();
    const token = await auth.sign({ dynamicUserId: "dyn_1", email: "bob@x.io" });
    const a = await call(appRouter.profile.me, undefined, {
      context: ctxFor(token),
    });
    const b = await call(appRouter.profile.me, undefined, {
      context: ctxFor(token),
    });
    expect(a.id).toBe(b.id);
    const rows = await db.query.user.findMany();
    expect(rows.length).toBe(1);
  });

  test("colliding email prefixes get deduped usernames", async () => {
    const { auth, ctxFor } = await harness();
    const t1 = await auth.sign({ dynamicUserId: "d1", email: "sam@a.com" });
    const t2 = await auth.sign({ dynamicUserId: "d2", email: "sam@b.com" });
    const u1 = await call(appRouter.profile.me, undefined, {
      context: ctxFor(t1),
    });
    const u2 = await call(appRouter.profile.me, undefined, {
      context: ctxFor(t2),
    });
    expect(u1.username).toBe("sam");
    expect(u2.username).toBe("sam2");
  });
});
