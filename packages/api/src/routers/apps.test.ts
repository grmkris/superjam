import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";

// Each test spins a fresh pglite + full migrations — slow under concurrent load.
setDefaultTimeout(20_000);
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import {
  allocateExternalApp,
  createExternalApp,
  finalizeExternalApp,
} from "./apps.ts";

const logger = createLogger({ level: "silent" });

const manifest = {
  name: "Tip Jar",
  slug: "tip-jar",
  description: "send a tip",
  iconEmoji: "💸",
  category: "tool" as const,
  capabilities: ["payments" as const],
};

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

describe("createExternalApp core", () => {
  test("inserts a listed app, derives entryOrigin, dedupes slug", async () => {
    const { db } = await harness();
    const schema = (await import("@superjam/db")).schema;
    const [u] = await db
      .insert(schema.user)
      .values({ dynamicUserId: "dyn_o", email: "o@test.io", username: "o" })
      .returning();
    const owner = u!.id;

    const a = await createExternalApp(db, {
      manifest,
      entryUrl: "https://tipjar.vercel.app/embed?x=1",
      ownerUserId: owner,
    });
    expect(a.slug).toBe("tip-jar");
    expect(a.entryOrigin).toBe("https://tipjar.vercel.app");
    expect(a.status).toBe("listed");
    expect(a.capabilities).toEqual(["payments"]);

    const b = await createExternalApp(db, {
      manifest,
      entryUrl: "https://other.vercel.app",
      ownerUserId: owner,
    });
    expect(b.slug).toBe("tip-jar-2"); // deduped
  });
});

describe("apps.registerExternal", () => {
  test("world-verified user registers an https app", async () => {
    const { db, auth, ctxFor } = await harness();
    const schema = (await import("@superjam/db")).schema;
    await db.insert(schema.user).values({
      dynamicUserId: "dyn_v",
      email: "v@test.io",
      username: "v",
      worldVerified: true,
    });
    const token = await auth.sign({ dynamicUserId: "dyn_v", email: "v@test.io" });

    const res = await call(
      appRouter.apps.registerExternal,
      { manifest, entryUrl: "https://mine.vercel.app" },
      { context: ctxFor(token) }
    );
    expect(res.slug).toBe("tip-jar");
  });

  test("rejects non-https entryUrl", async () => {
    const { db, auth, ctxFor } = await harness();
    const schema = (await import("@superjam/db")).schema;
    await db.insert(schema.user).values({
      dynamicUserId: "dyn_v",
      email: "v@test.io",
      username: "v",
      worldVerified: true,
    });
    const token = await auth.sign({ dynamicUserId: "dyn_v", email: "v@test.io" });
    await expect(
      call(
        appRouter.apps.registerExternal,
        { manifest, entryUrl: "http://mine.vercel.app" },
        { context: ctxFor(token) }
      )
    ).rejects.toBeInstanceOf(ORPCError);
  });

  test("rejects a non-world-verified user (human gate)", async () => {
    const { db, auth, ctxFor } = await harness();
    const schema = (await import("@superjam/db")).schema;
    await db.insert(schema.user).values({
      dynamicUserId: "dyn_p",
      email: "p@test.io",
      username: "p",
      worldVerified: false,
    });
    const token = await auth.sign({ dynamicUserId: "dyn_p", email: "p@test.io" });
    await expect(
      call(
        appRouter.apps.registerExternal,
        { manifest, entryUrl: "https://mine.vercel.app" },
        { context: ctxFor(token) }
      )
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("allocate → finalize (builder/hosting flow)", () => {
  test("allocate reserves a building appId (not viewable), finalize lists it", async () => {
    const { db, ctxFor } = await harness();
    const schema = (await import("@superjam/db")).schema;
    const [u] = await db
      .insert(schema.user)
      .values({ dynamicUserId: "dyn_b", email: "b@test.io", username: "b" })
      .returning();

    // Phase 1: reserve the id BEFORE deploy (builder injects it as SUPERJAM_APP_ID).
    const allocated = await allocateExternalApp(db, {
      manifest,
      ownerUserId: u!.id,
    });
    expect(allocated.status).toBe("building");
    expect(allocated.entryUrl).toBeNull();
    // Not viewable while building.
    await expect(
      call(appRouter.apps.get, { slug: allocated.slug }, { context: ctxFor() })
    ).rejects.toBeInstanceOf(ORPCError);

    // Phase 2: after deploy, attach the URL + list it.
    const listed = await finalizeExternalApp(db, {
      appId: allocated.id,
      entryUrl: "https://built.vercel.app/x",
    });
    expect(listed.id).toBe(allocated.id); // same appId the app was built with
    expect(listed.status).toBe("listed");
    expect(listed.entryOrigin).toBe("https://built.vercel.app");

    const view = await call(
      appRouter.apps.get,
      { slug: allocated.slug },
      { context: ctxFor() }
    );
    expect(view.entryUrl).toBe("https://built.vercel.app/x");
  });

  test("finalize throws on an unknown appId", async () => {
    const { db } = await harness();
    const { typeIdGenerator } = await import("@superjam/shared");
    await expect(
      finalizeExternalApp(db, {
        appId: typeIdGenerator("app"), // valid format, never inserted
        entryUrl: "https://x.vercel.app",
      })
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("apps.get (public viewer lookup)", () => {
  test("returns a listed external app's entryUrl + caps", async () => {
    const { db, ctxFor } = await harness();
    const schema = (await import("@superjam/db")).schema;
    const [u] = await db
      .insert(schema.user)
      .values({ dynamicUserId: "dyn_g", email: "g@test.io", username: "g" })
      .returning();
    await createExternalApp(db, {
      manifest,
      entryUrl: "https://tipjar.vercel.app",
      ownerUserId: u!.id,
    });
    const res = await call(
      appRouter.apps.get,
      { slug: "tip-jar" },
      { context: ctxFor() }
    );
    expect(res.entryUrl).toBe("https://tipjar.vercel.app");
    expect(res.entryOrigin).toBe("https://tipjar.vercel.app");
    expect(res.capabilities).toEqual(["payments"]);
  });

  test("404 for an unknown slug", async () => {
    const { ctxFor } = await harness();
    await expect(
      call(appRouter.apps.get, { slug: "nope" }, { context: ctxFor() })
    ).rejects.toBeInstanceOf(ORPCError);
  });
});
