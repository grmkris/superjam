import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import type { AppSpec, RefineResult } from "@superjam/shared";
import { eq } from "drizzle-orm";

// Fresh pglite + migrations per test — slow under concurrent load.
setDefaultTimeout(20_000);
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import { createBuildsRouter, type RefineFn } from "./builds.ts";

const logger = createLogger({ level: "silent" });

const SPEC: AppSpec = {
  name: "Tip Jar",
  slug: "tip-jar",
  description: "Send a USDC tip.",
  iconEmoji: "💸",
  category: "tool",
  capabilities: ["payments"],
  features: ["Tip button"],
  data: { collections: [], counters: [], storage: [] },
  ui: { layout: "one column", sections: ["tip"] },
  acceptance: ["Tipping works"],
};

const specResult: RefineResult = { type: "spec", spec: SPEC };

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
  return { db, auth, ctxFor };
};

describe("builds.refine", () => {
  test("returns the refiner's result for an authed user", async () => {
    const { auth, ctxFor } = await harness();
    const refine: RefineFn = async () => specResult;
    const router = createBuildsRouter({ refine });
    const token = await auth.sign({ dynamicUserId: "dyn_a", email: "a@test.io" });

    const res = await call(
      router.refine,
      { prompt: "a tip jar" },
      { context: ctxFor(token) }
    );
    expect(res).toEqual(specResult);
  });

  test("requires authentication", async () => {
    const { ctxFor } = await harness();
    const router = createBuildsRouter({ refine: async () => specResult });
    await expect(
      call(router.refine, { prompt: "x" }, { context: ctxFor() })
    ).rejects.toThrow(ORPCError);
  });

  test("injects the listed-apps catalog on the first pass only", async () => {
    const { db, auth, ctxFor } = await harness();
    const owner = await createTestUser(db);
    await createTestApp(db, owner.id, { slug: "rival", status: "listed" });

    const seen: { catalog?: unknown; baseSpec?: unknown }[] = [];
    const refine: RefineFn = async (input) => {
      seen.push({ catalog: input.catalog, baseSpec: input.baseSpec });
      return specResult;
    };
    const router = createBuildsRouter({ refine });
    const token = await auth.sign({ dynamicUserId: "dyn_b", email: "b@test.io" });

    // first pass — catalog injected
    await call(router.refine, { prompt: "idea" }, { context: ctxFor(token) });
    // adjust re-refine (answers present) — catalog skipped
    await call(
      router.refine,
      { prompt: "idea", answers: [{ q: "q", a: "a" }] },
      { context: ctxFor(token) }
    );

    expect(seen[0]?.catalog).toHaveLength(1);
    expect(seen[1]?.catalog).toBeUndefined();
  });

  test("loads the base spec when remixing", async () => {
    const { db, auth, ctxFor } = await harness();
    const owner = await createTestUser(db);
    const baseApp = await createTestApp(db, owner.id, { status: "listed" });
    const [b] = await db
      .insert(schema.build)
      .values({ appId: baseApp.id, userId: owner.id, prompt: "orig", spec: SPEC })
      .returning();
    await db
      .update(schema.app)
      .set({ currentBuildId: b!.id })
      .where(eq(schema.app.id, baseApp.id));

    let seenBase: AppSpec | undefined;
    const refine: RefineFn = async (input) => {
      seenBase = input.baseSpec;
      return specResult;
    };
    const router = createBuildsRouter({ refine });
    const token = await auth.sign({ dynamicUserId: "dyn_c", email: "c@test.io" });

    await call(
      router.refine,
      { prompt: "make it neon", remixOfAppId: baseApp.id },
      { context: ctxFor(token) }
    );
    expect(seenBase?.slug).toBe("tip-jar");
  });

  test("enforces the daily refine quota and refunds on refiner failure", async () => {
    const { db, auth } = await harness();
    const rateLimiter = createRateLimiter();
    await createTestUser(db, { dynamicUserId: "dyn_q", email: "q@test.io" });

    // a context that shares ONE rate limiter so the daily counter accumulates
    const ctx = () =>
      createContext({
        db,
        logger,
        auth: auth.verifier,
        rateLimiter,
        headers: new Headers({
          authorization: `Bearer ${tokenHolder.token}`,
        }),
      });
    const tokenHolder = {
      token: await auth.sign({ dynamicUserId: "dyn_q", email: "q@test.io" }),
    };

    let calls = 0;
    const refine: RefineFn = async () => {
      calls += 1;
      throw new Error("boom"); // always fails → unit must be refunded
    };
    const router = createBuildsRouter({ refine });

    // Refiner failure surfaces as INTERNAL, and refunds the quota unit.
    for (let i = 0; i < 3; i += 1) {
      await expect(
        call(router.refine, { prompt: "x" }, { context: ctx() })
      ).rejects.toThrow(ORPCError);
    }
    // 3 failed attempts each refunded ⇒ the daily counter is still 0, so a
    // 4th call is admitted (reaches the refiner) rather than 429'd.
    expect(calls).toBe(3);
    await expect(
      call(router.refine, { prompt: "x" }, { context: ctx() })
    ).rejects.toThrow(/unavailable/);
    expect(calls).toBe(4);
  });
});
