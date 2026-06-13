import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import type { AppSpec, RefineResult } from "@superjam/shared";
import { nullOnchain, type Onchain, parseUsdc } from "@superjam/onchain";
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
  type BuildPaymentVerifier,
  type DeployerFor,
  type RefineFn,
} from "./builds.ts";
import type { BuilderCapability, UserId } from "@superjam/shared";

// Seed an active marketplace agent that can deliver the SPEC (payments →
// contracts:evm). Returns the inserted row.
const seedAgent = async (
  db: Awaited<ReturnType<typeof harness>>["db"],
  ownerUserId: UserId,
  over: Partial<typeof schema.builderAgent.$inferInsert> = {}
) => {
  const [a] = await db
    .insert(schema.builderAgent)
    .values({
      ownerUserId,
      name: "House Builder",
      slug: "house",
      endpointUrl: "https://builder.superjam.fun/dispatch",
      token: "house-token",
      priceUsdc: "1",
      capabilities: [
        "frontend",
        "hosting:vercel",
        "contracts:evm",
        "database:neon",
        "ai",
      ] as BuilderCapability[],
      walletAddress: "0x" + "a".repeat(40),
      status: "active",
      ...over,
    })
    .returning();
  return a!;
};

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
  const ctxFor = (token?: string, onchain?: Onchain) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      onchain,
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

describe("builds.create — trial quota", () => {
  test("first build is free for a non-verified user; inserts + returns ids", async () => {
    const { db, auth, ctxFor } = await harness();
    const router = createBuildsRouter({ deploy: parkedDeploy });
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

  test("second build by a non-verified user without payment is forbidden", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_g",
      email: "g@test.io",
      worldVerified: false,
    });
    await db
      .insert(schema.build)
      .values({ userId: u.id, prompt: "prior", spec: SPEC, status: "done" });

    const router = createBuildsRouter({ deploy: parkedDeploy });
    const token = await auth.sign({ dynamicUserId: "dyn_g", email: "g@test.io" });
    await expect(
      call(router.create, { spec: SPEC }, { context: ctxFor(token) })
    ).rejects.toThrow(/human/);
  });

  test("a world-verified user builds past the free quota", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_h",
      email: "h@test.io",
      worldVerified: true,
    });
    await db
      .insert(schema.build)
      .values({ userId: u.id, prompt: "prior", spec: SPEC, status: "done" });

    const router = createBuildsRouter({ deploy: parkedDeploy });
    const token = await auth.sign({ dynamicUserId: "dyn_h", email: "h@test.io" });
    const res = await call(
      router.create,
      { spec: SPEC },
      { context: ctxFor(token) }
    );
    expect(res.buildId).toMatch(/^bld_/);
  });

  test("a verified USDC receipt pays past the free quota", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_p2",
      email: "p2@test.io",
      worldVerified: false,
    });
    await db
      .insert(schema.build)
      .values({ userId: u.id, prompt: "prior", spec: SPEC, status: "done" });

    let verified: string | undefined;
    const verifyPayment: BuildPaymentVerifier = async (payment) => {
      verified = payment.txHash;
    };
    const router = createBuildsRouter({ deploy: parkedDeploy, verifyPayment });
    const token = await auth.sign({ dynamicUserId: "dyn_p2", email: "p2@test.io" });

    const res = await call(
      router.create,
      { spec: SPEC, payment: { txHash: "0xabc", chain: "arc-testnet" } },
      { context: ctxFor(token) }
    );
    expect(verified).toBe("0xabc");
    expect(res.buildId).toMatch(/^bld_/);
  });

  test("a rejected receipt yields PAYMENT_REQUIRED", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_r",
      email: "r@test.io",
      worldVerified: false,
    });
    await db
      .insert(schema.build)
      .values({ userId: u.id, prompt: "prior", spec: SPEC, status: "done" });

    const verifyPayment: BuildPaymentVerifier = async () => {
      throw new Error("no matching transfer");
    };
    const router = createBuildsRouter({ deploy: parkedDeploy, verifyPayment });
    const token = await auth.sign({ dynamicUserId: "dyn_r", email: "r@test.io" });

    await expect(
      call(
        router.create,
        { spec: SPEC, payment: { txHash: "0xbad", chain: "arc-testnet" } },
        { context: ctxFor(token) }
      )
    ).rejects.toThrow(/transfer/);
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

describe("builds — marketplace routing (§14)", () => {
  test("runBuild credits the routed agent a build on success", async () => {
    const { db } = await harness();
    const owner = await createTestUser(db);
    const agent = await seedAgent(db, owner.id);
    const [b] = await db
      .insert(schema.build)
      .values({ userId: owner.id, prompt: "idea", spec: SPEC, status: "queued" })
      .returning();
    const allocated = await allocateExternalApp(db, {
      manifest: deployResult.manifest,
      ownerUserId: owner.id,
      buildId: b!.id,
    });
    const deploy: BuildDeployer = async () => deployResult;

    await runBuild(db, logger, deploy, {
      buildId: b!.id,
      appId: allocated.id,
      spec: SPEC,
      routedAgentId: agent.id,
    });

    const after = await db.query.builderAgent.findFirst({
      where: eq(schema.builderAgent.id, agent.id),
    });
    expect(after?.buildsCount).toBe(1);

    // §16: the minted app is linked to the agent that built it (review→reputation).
    const builtApp = await db.query.app.findFirst({
      where: eq(schema.app.id, allocated.id),
    });
    expect(builtApp?.builtByAgentId).toBe(agent.id);
  });

  test("create routes to the chosen eligible agent's endpoint + token", async () => {
    const { db, auth, ctxFor } = await harness();
    const aOwner = await createTestUser(db, { username: "houseowner" });
    // Free agent → routing is exercised without tripping the paid-to-agent gate.
    const agent = await seedAgent(db, aOwner.id, { priceUsdc: "0" });
    const calls: Array<{ endpointUrl: string; token: string }> = [];
    const deployerFor: DeployerFor = (b) => {
      calls.push({ endpointUrl: b.endpointUrl, token: b.token });
      return parkedDeploy;
    };
    const router = createBuildsRouter({ deploy: parkedDeploy, deployerFor });
    const token = await auth.sign({ dynamicUserId: "dyn_r", email: "r@test.io" });

    await call(
      router.create,
      { spec: SPEC, agentId: agent.id },
      { context: ctxFor(token) }
    );
    // Selection happens synchronously in the handler before runBuild is spawned.
    expect(calls).toEqual([
      { endpointUrl: agent.endpointUrl, token: agent.token },
    ]);
  });

  test("create falls back to the house deployer when no agent can deliver", async () => {
    const { auth, ctxFor } = await harness();
    let routed = false;
    const deployerFor: DeployerFor = () => {
      routed = true;
      return parkedDeploy;
    };
    const router = createBuildsRouter({ deploy: parkedDeploy, deployerFor });
    const token = await auth.sign({ dynamicUserId: "dyn_s", email: "s@test.io" });

    // No agents seeded ⇒ selectEligibleBuilder returns null ⇒ house deployer.
    await call(router.create, { spec: SPEC }, { context: ctxFor(token) });
    expect(routed).toBe(false);
  });

  // --- paid-to-agent gate (§14): "I paid another human's AI" ---
  const USER_WALLET = ("0x" + "b".repeat(40)) as `0x${string}`;
  const paidOnchain = (from: `0x${string}` = USER_WALLET): Onchain => ({
    ...nullOnchain,
    verifyUsdcTransfer: async () => ({ from, value: parseUsdc("1") }),
  });
  const paidRouter = () =>
    createBuildsRouter({ deploy: parkedDeploy, deployerFor: () => parkedDeploy });

  test("a paid agent requires payment (PAYMENT_REQUIRED without a receipt)", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_pa1",
      email: "pa1@test.io",
      walletAddress: USER_WALLET,
    });
    const agent = await seedAgent(db, u.id); // default priceUsdc "1"
    const token = await auth.sign({ dynamicUserId: "dyn_pa1", email: "pa1@test.io" });

    await expect(
      call(
        paidRouter().create,
        { spec: SPEC, agentId: agent.id },
        { context: ctxFor(token) }
      )
    ).rejects.toThrow(/Pay 1 USDC/);
  });

  test("a paid agent: a verified receipt is recorded on the build", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_pa2",
      email: "pa2@test.io",
      walletAddress: USER_WALLET,
    });
    const agent = await seedAgent(db, u.id);
    const token = await auth.sign({ dynamicUserId: "dyn_pa2", email: "pa2@test.io" });

    const res = await call(
      paidRouter().create,
      { spec: SPEC, agentId: agent.id, payment: { txHash: "0xpaid1", chain: "arc" } },
      { context: ctxFor(token, paidOnchain()) }
    );
    const b = await db.query.build.findFirst({
      where: eq(schema.build.id, res.buildId),
    });
    expect(b?.paymentTxHash).toBe("0xpaid1");
    expect(b?.agentId).toBe(agent.id);
  });

  test("a reused agent-payment receipt is rejected (replay guard)", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_pa3",
      email: "pa3@test.io",
      walletAddress: USER_WALLET,
      worldVerified: true, // skip the trial-quota gate on the 2nd build
    });
    const agent = await seedAgent(db, u.id);
    const token = await auth.sign({ dynamicUserId: "dyn_pa3", email: "pa3@test.io" });
    const pay = {
      spec: SPEC,
      agentId: agent.id,
      payment: { txHash: "0xdupe", chain: "arc" },
    };

    await call(paidRouter().create, pay, { context: ctxFor(token, paidOnchain()) });
    await expect(
      call(paidRouter().create, pay, { context: ctxFor(token, paidOnchain()) })
    ).rejects.toThrow(/already used/);
  });

  test("a paid agent: payment from a different wallet is rejected", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db, {
      dynamicUserId: "dyn_pa4",
      email: "pa4@test.io",
      walletAddress: USER_WALLET,
    });
    const agent = await seedAgent(db, u.id);
    const token = await auth.sign({ dynamicUserId: "dyn_pa4", email: "pa4@test.io" });
    const stranger = ("0x" + "c".repeat(40)) as `0x${string}`;

    await expect(
      call(
        paidRouter().create,
        { spec: SPEC, agentId: agent.id, payment: { txHash: "0xpaid4", chain: "arc" } },
        { context: ctxFor(token, paidOnchain(stranger)) }
      )
    ).rejects.toThrow(/your own wallet/);
  });
});
