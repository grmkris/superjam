import { beforeEach, describe, expect, test } from "bun:test";
import { call } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import { createContext } from "../context.ts";
import type {
  AgentReputation,
  AgentReputationInput,
} from "../lib/agent-reputation.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import { createTestAuth, type TestAuth } from "../auth/test-auth.ts";
import { reviewsRouter } from "./reviews.ts";

const logger = createLogger({ level: "silent" });

let db: Database;
let auth: TestAuth;
beforeEach(async () => {
  ({ db } = await createPgliteDb());
  auth = await createTestAuth();
});

const ctxFor = (token?: string, agentReputation?: AgentReputation) =>
  createContext({
    db,
    logger,
    auth: auth.verifier,
    rateLimiter: createRateLimiter(),
    agentReputation,
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
  });

const userWithToken = async (
  dynamicUserId: string,
  worldVerified: boolean
) => {
  const u = await createTestUser(db, { dynamicUserId, worldVerified });
  const token = await auth.sign({ dynamicUserId, email: u.email });
  return { u, token };
};

describe("reviews", () => {
  test("unverified user cannot review (worldVerified gate)", async () => {
    const { token } = await userWithToken("du", false);
    const owner = await createTestUser(db);
    const app = await createTestApp(db, owner.id, { status: "listed" });
    await expect(
      call(reviewsRouter.upsert, { appId: app.id, rating: 5 }, { context: ctxFor(token) })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("verified upsert appears in public list; 2nd upsert edits in place", async () => {
    const { u, token } = await userWithToken("dv", true);
    const owner = await createTestUser(db);
    const app = await createTestApp(db, owner.id, { status: "listed" });

    await call(
      reviewsRouter.upsert,
      { appId: app.id, rating: 4, text: "nice jam" },
      { context: ctxFor(token) }
    );
    let listed = await call(
      reviewsRouter.list,
      { appId: app.id },
      { context: ctxFor() } // public, no token
    );
    expect(listed.reviews).toHaveLength(1);
    expect(listed.reviews[0]).toMatchObject({
      username: u.username,
      worldVerified: true,
      rating: 4,
      text: "nice jam",
    });

    // second submit = edit (UNIQUE app,user), not a new row
    await call(
      reviewsRouter.upsert,
      { appId: app.id, rating: 2 },
      { context: ctxFor(token) }
    );
    listed = await call(reviewsRouter.list, { appId: app.id }, { context: ctxFor() });
    expect(listed.reviews).toHaveLength(1);
    expect(listed.reviews[0]?.rating).toBe(2);
  });

  test("rating bounds reject 0 and 6", async () => {
    const { token } = await userWithToken("dv", true);
    const owner = await createTestUser(db);
    const app = await createTestApp(db, owner.id, { status: "listed" });
    await expect(
      call(reviewsRouter.upsert, { appId: app.id, rating: 0 }, { context: ctxFor(token) })
    ).rejects.toThrow();
    await expect(
      call(reviewsRouter.upsert, { appId: app.id, rating: 6 }, { context: ctxFor(token) })
    ).rejects.toThrow();
  });

  test("cannot review your own jam", async () => {
    const { u, token } = await userWithToken("dv", true);
    const app = await createTestApp(db, u.id, { status: "listed" });
    await expect(
      call(reviewsRouter.upsert, { appId: app.id, rating: 5 }, { context: ctxFor(token) })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("remove deletes own review", async () => {
    const { token } = await userWithToken("dv", true);
    const owner = await createTestUser(db);
    const app = await createTestApp(db, owner.id, { status: "listed" });
    await call(reviewsRouter.upsert, { appId: app.id, rating: 5 }, { context: ctxFor(token) });
    await call(reviewsRouter.remove, { appId: app.id }, { context: ctxFor(token) });
    const listed = await call(reviewsRouter.list, { appId: app.id }, { context: ctxFor() });
    expect(listed.reviews).toHaveLength(0);
  });
});

describe("reviews → agent reputation (§16)", () => {
  // An agent-built, listed jam owned by someone other than the reviewer.
  const agentBuiltApp = async (erc8004Id: string | null) => {
    const builderOwner = await createTestUser(db);
    const [agent] = await db
      .insert(schema.builderAgent)
      .values({
        ownerUserId: builderOwner.id,
        name: "Rep Builder",
        slug: "rep-builder",
        endpointUrl: "https://b.example/dispatch",
        token: "tok",
        walletAddress: "0x" + "a".repeat(40),
        erc8004Id,
        status: "active",
      })
      .returning();
    const appOwner = await createTestUser(db);
    const app = await createTestApp(db, appOwner.id, {
      status: "listed",
      builtByAgentId: agent!.id,
    });
    return { agent: agent!, app };
  };

  const captor = () => {
    const calls: AgentReputationInput[] = [];
    const rep: AgentReputation = {
      recordReview: async (i) => {
        calls.push(i);
      },
    };
    return { calls, rep };
  };

  test("a verified review on an agent-built jam records reputation", async () => {
    const { token } = await userWithToken("drep1", true);
    const { app } = await agentBuiltApp("8004:42");
    const { calls, rep } = captor();
    await call(
      reviewsRouter.upsert,
      { appId: app.id, rating: 5, text: "great" },
      { context: ctxFor(token, rep) }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ erc8004Id: "8004:42", rating: 5, text: "great" });
  });

  test("no reputation write when the builder has no erc8004Id yet", async () => {
    const { token } = await userWithToken("drep2", true);
    const { app } = await agentBuiltApp(null);
    const { calls, rep } = captor();
    await call(
      reviewsRouter.upsert,
      { appId: app.id, rating: 4 },
      { context: ctxFor(token, rep) }
    );
    expect(calls).toHaveLength(0);
  });

  test("no reputation write for a non-agent jam", async () => {
    const { token } = await userWithToken("drep3", true);
    const owner = await createTestUser(db);
    const app = await createTestApp(db, owner.id, { status: "listed" });
    const { calls, rep } = captor();
    await call(
      reviewsRouter.upsert,
      { appId: app.id, rating: 4 },
      { context: ctxFor(token, rep) }
    );
    expect(calls).toHaveLength(0);
  });

  test("a failed reputation write never fails the review", async () => {
    const { token } = await userWithToken("drep4", true);
    const { app } = await agentBuiltApp("8004:99");
    const rep: AgentReputation = {
      recordReview: async () => {
        throw new Error("8004 down");
      },
    };
    await call(
      reviewsRouter.upsert,
      { appId: app.id, rating: 3 },
      { context: ctxFor(token, rep) }
    );
    const listed = await call(reviewsRouter.list, { appId: app.id }, { context: ctxFor() });
    expect(listed.reviews).toHaveLength(1);
    expect(listed.reviews[0]?.rating).toBe(3);
  });
});
