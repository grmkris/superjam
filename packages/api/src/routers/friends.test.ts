import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";

setDefaultTimeout(20_000);
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import { createTestUser } from "../testing/factories.ts";

const logger = createLogger({ level: "silent" });

const harness = async () => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const rateLimiter = createRateLimiter();
  const ctxFor = (token?: string) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    });
  const tokenFor = (u: { dynamicUserId: string | null; email: string }) =>
    auth.sign({ dynamicUserId: u.dynamicUserId!, email: u.email });
  return { db, auth, ctxFor, tokenFor };
};

describe("friends.add / list (instant, mutual)", () => {
  test("add makes a mutual friendship visible from BOTH sides", async () => {
    const { db, ctxFor, tokenFor } = await harness();
    const alice = await createTestUser(db, { username: "alice" });
    const bob = await createTestUser(db, { username: "bob" });
    const aliceTok = await tokenFor(alice);
    const bobTok = await tokenFor(bob);

    await call(appRouter.friends.add, { username: "bob" }, { context: ctxFor(aliceTok) });

    const aliceFriends = await call(appRouter.friends.list, undefined, {
      context: ctxFor(aliceTok),
    });
    const bobFriends = await call(appRouter.friends.list, undefined, {
      context: ctxFor(bobTok),
    });
    expect(aliceFriends.friends.map((f) => f.username)).toEqual(["bob"]);
    expect(bobFriends.friends.map((f) => f.username)).toEqual(["alice"]);
  });

  test("add is idempotent + canonical (A→B then B→A = one friendship)", async () => {
    const { db, ctxFor, tokenFor } = await harness();
    const alice = await createTestUser(db, { username: "alice" });
    const bob = await createTestUser(db, { username: "bob" });
    const aliceTok = await tokenFor(alice);
    const bobTok = await tokenFor(bob);

    await call(appRouter.friends.add, { username: "bob" }, { context: ctxFor(aliceTok) });
    await call(appRouter.friends.add, { username: "alice" }, { context: ctxFor(bobTok) });
    await call(appRouter.friends.add, { username: "bob" }, { context: ctxFor(aliceTok) });

    const rows = await db.query.friendship.findMany();
    expect(rows).toHaveLength(1);
    const aliceFriends = await call(appRouter.friends.list, undefined, {
      context: ctxFor(aliceTok),
    });
    expect(aliceFriends.friends).toHaveLength(1);
  });

  test("rejects adding yourself + an unknown user", async () => {
    const { db, ctxFor, tokenFor } = await harness();
    const alice = await createTestUser(db, { username: "alice" });
    const tok = await tokenFor(alice);
    await expect(
      call(appRouter.friends.add, { username: "alice" }, { context: ctxFor(tok) })
    ).rejects.toBeInstanceOf(ORPCError);
    await expect(
      call(appRouter.friends.add, { username: "ghost" }, { context: ctxFor(tok) })
    ).rejects.toBeInstanceOf(ORPCError);
  });

  test("remove drops it from both lists", async () => {
    const { db, ctxFor, tokenFor } = await harness();
    const alice = await createTestUser(db, { username: "alice" });
    const bob = await createTestUser(db, { username: "bob" });
    const aliceTok = await tokenFor(alice);
    const bobTok = await tokenFor(bob);
    await call(appRouter.friends.add, { username: "bob" }, { context: ctxFor(aliceTok) });
    await call(appRouter.friends.remove, { username: "alice" }, { context: ctxFor(bobTok) });
    const aliceFriends = await call(appRouter.friends.list, undefined, {
      context: ctxFor(aliceTok),
    });
    expect(aliceFriends.friends).toHaveLength(0);
  });
});
