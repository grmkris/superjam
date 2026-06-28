import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import type { AppSpec, RefineResult } from "@superjam/shared";
import { type Onchain } from "@superjam/onchain";
import { eq } from "drizzle-orm";

// Fresh pglite + migrations per test — slow under concurrent load.
setDefaultTimeout(20_000);
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import type { BuildDeployer } from "../lib/builder-dispatch.ts";
import type { DeployResult } from "@superjam/builder/deploy";
import { allocateExternalApp } from "./apps.ts";
import {
  createBuildsRouter,
  runBuild,
  type DeployerFor,
  type RefineFn,
} from "./builds.ts";

const logger = createLogger({ level: "silent" });

// The house builder dispatch creds (env-driven) the context carries.
const BUILDER_ENDPOINT = "https://builder.superjam.fun/dispatch";
const BUILDER_TOKEN = "house-token";

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
  const ctxFor = (token?: string, onchain?: Onchain) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      onchain,
      builderEndpoint: BUILDER_ENDPOINT,
      builderToken: BUILDER_TOKEN,
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

const deployResult: DeployResult = {
  entryUrl: "https://superjam-app1.vercel.app",
  manifest: {
    name: "Tip Jar",
    slug: "tip-jar",
    description: "Send a USDC tip.",
    iconEmoji: "💸",
    category: "tool",
    capabilities: ["payments"],
  },
  vercelProject: "prj_1",
  durationMs: 1234,
};

// A deployer that parks forever — keeps the fire-and-forget driver from doing
// DB work after a create() test returns.
const parkedDeploy: BuildDeployer = () => new Promise<DeployResult>(() => {});

describe("builds.create — free builds", () => {
  test("a build inserts + returns ids and dispatches", async () => {
    const { db, auth, ctxFor } = await harness();
    const router = createBuildsRouter({ deployerFor: () => parkedDeploy });
    const token = await auth.sign({ dynamicUserId: "dyn_f", email: "f@test.io" });

    const res = await call(
      router.create,
      { spec: SPEC },
      { context: ctxFor(token) }
    );
    expect(res.buildId).toMatch(/^bld_/);
    expect(res.appId).toMatch(/^app_/);
    expect(res.status).toBe("queued");

    const rows = await db.select().from(schema.build);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.spec?.slug).toBe("tip-jar");
  });

  test("builds are unlimited — a second build by the same user succeeds", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_g",
      email: "g@test.io",
    });
    await db
      .insert(schema.build)
      .values({ userId: u.id, prompt: "prior", spec: SPEC, status: "done" });

    const router = createBuildsRouter({ deployerFor: () => parkedDeploy });
    const token = await auth.sign({ dynamicUserId: "dyn_g", email: "g@test.io" });
    const res = await call(
      router.create,
      { spec: SPEC },
      { context: ctxFor(token) }
    );
    expect(res.buildId).toMatch(/^bld_/);
  });
});

describe("runBuild driver", () => {
  test("deploys, marks the build done, and finalizes (lists) the allocated app", async () => {
    const { db } = await harness();
    const owner = await createTestUser(db);
    const [b] = await db
      .insert(schema.build)
      .values({ userId: owner.id, prompt: "idea", spec: SPEC, status: "queued" })
      .returning();
    // create() allocates the row up front; mirror that here.
    const allocated = await allocateExternalApp(db, {
      manifest: deployResult.manifest,
      ownerUserId: owner.id,
      buildId: b!.id,
    });
    expect(allocated.status).toBe("building");

    const deploy: BuildDeployer = async () => deployResult;
    await runBuild(db, logger, deploy, {
      buildId: b!.id,
      appId: allocated.id,
      spec: SPEC,
    });

    const built = await db.query.build.findFirst({ where: eq(schema.build.id, b!.id) });
    expect(built?.status).toBe("done");
    expect(built?.manifest?.slug).toBe("tip-jar");

    const app = await db.query.app.findFirst({ where: eq(schema.app.id, allocated.id) });
    expect(app?.status).toBe("listed");
    expect(app?.entryUrl).toBe("https://superjam-app1.vercel.app");
  });

  test("a deploy failure marks the build failed (never throws)", async () => {
    const { db } = await harness();
    const owner = await createTestUser(db);
    const [b] = await db
      .insert(schema.build)
      .values({ userId: owner.id, prompt: "idea", spec: SPEC, status: "queued" })
      .returning();
    const allocated = await allocateExternalApp(db, {
      manifest: deployResult.manifest,
      ownerUserId: owner.id,
      buildId: b!.id,
    });

    const deploy: BuildDeployer = async () => {
      throw new Error("vercel exploded");
    };
    await runBuild(db, logger, deploy, {
      buildId: b!.id,
      appId: allocated.id,
      spec: SPEC,
    });

    const built = await db.query.build.findFirst({ where: eq(schema.build.id, b!.id) });
    expect(built?.status).toBe("failed");
    expect(built?.error).toContain("vercel exploded");
    // the allocated row stays 'building' (invisible), never listed
    const app = await db.query.app.findFirst({ where: eq(schema.app.id, allocated.id) });
    expect(app?.status).toBe("building");
  });

  test("a finalize failure leaves the build done (finalize never fails it)", async () => {
    const { db } = await harness();
    const owner = await createTestUser(db);
    const [b] = await db
      .insert(schema.build)
      .values({ userId: owner.id, prompt: "idea", spec: SPEC, status: "queued" })
      .returning();
    const allocated = await allocateExternalApp(db, {
      manifest: deployResult.manifest,
      ownerUserId: owner.id,
      buildId: b!.id,
    });

    // an un-parseable entryUrl makes finalizeExternalApp throw (new URL(...))
    const deploy: BuildDeployer = async () => ({
      ...deployResult,
      entryUrl: "not-a-url",
    });
    await runBuild(db, logger, deploy, {
      buildId: b!.id,
      appId: allocated.id,
      spec: SPEC,
    });

    const built = await db.query.build.findFirst({ where: eq(schema.build.id, b!.id) });
    expect(built?.status).toBe("done");
    const app = await db.query.app.findFirst({ where: eq(schema.app.id, allocated.id) });
    expect(app?.status).toBe("building"); // never finalized → stays unlisted
  });
});

describe("builds.status", () => {
  test("returns own build's status; forbids another user's", async () => {
    const { db, auth, ctxFor } = await harness();
    const owner = await createTestUser(db, { username: "owner1" });
    const [b] = await db
      .insert(schema.build)
      .values({ userId: owner.id, prompt: "a tip jar", status: "generating" })
      .returning();
    const ownerToken = await auth.sign({
      dynamicUserId: owner.dynamicUserId!,
      email: owner.email,
    });
    const router = createBuildsRouter();

    const res = await call(
      router.status,
      { buildId: b!.id },
      { context: ctxFor(ownerToken) }
    );
    expect(res.status).toBe("generating");
    expect(res.slug).toBeNull();
    expect(res.appStatus).toBeNull();

    const other = await createTestUser(db, { username: "other1" });
    const otherToken = await auth.sign({
      dynamicUserId: other.dynamicUserId!,
      email: other.email,
    });
    await expect(
      call(router.status, { buildId: b!.id }, { context: ctxFor(otherToken) })
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("builds — env dispatch", () => {
  test("create dispatches to the env builder endpoint + token", async () => {
    const { auth, ctxFor } = await harness();
    const calls: Array<{ endpointUrl: string; token: string }> = [];
    const deployerFor: DeployerFor = (b) => {
      calls.push({ endpointUrl: b.endpointUrl, token: b.token });
      return parkedDeploy;
    };
    const router = createBuildsRouter({ deployerFor });
    const token = await auth.sign({ dynamicUserId: "dyn_r", email: "r@test.io" });

    await call(router.create, { spec: SPEC }, { context: ctxFor(token) });
    // The deployer is built from the context's BUILDER_URL/BUILDER_TOKEN.
    expect(calls).toEqual([
      { endpointUrl: BUILDER_ENDPOINT, token: BUILDER_TOKEN },
    ]);
  });

  test("create rejects when no builder is configured", async () => {
    const { db, auth } = await harness();
    const rateLimiter = createRateLimiter();
    // A context with NO builder creds + no deployerFor override ⇒ reject.
    const ctxNoBuilder = (token: string) =>
      createContext({
        db,
        logger,
        auth: auth.verifier,
        rateLimiter,
        headers: new Headers({ authorization: `Bearer ${token}` }),
      });
    const router = createBuildsRouter();
    const token = await auth.sign({ dynamicUserId: "dyn_s", email: "s@test.io" });

    await expect(
      call(router.create, { spec: SPEC }, { context: ctxNoBuilder(token) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
