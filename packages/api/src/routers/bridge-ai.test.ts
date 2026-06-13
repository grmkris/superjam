import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import { AI_CALLS_PER_USER_APP_DAY } from "@superjam/shared";

setDefaultTimeout(20_000);
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import { type AiRunner, createAiService } from "../services/ai-service.ts";
import { createAiBridge } from "./bridge-ai.ts";

const logger = createLogger({ level: "silent" });

const harness = async (runner: AiRunner) => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const rateLimiter = createRateLimiter();
  const owner = await createTestUser(db);
  const app = await createTestApp(db, owner.id, { status: "listed" });
  const token = await auth.sign({
    dynamicUserId: "dyn_ai",
    email: "ai@test.io",
  });
  const ctx = () =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
  const router = createAiBridge({ service: createAiService({ runner }) });
  return { router, ctx, appId: app.id, rateLimiter };
};

const textReq = (prompt: string) =>
  ({ mode: "text", prompt }) as const;

describe("bridge.ai.chat", () => {
  test("proxies a text call for a known app", async () => {
    const { router, ctx, appId } = await harness(async () => ({ text: "hi back" }));
    const res = await call(
      router.chat,
      { appId, request: textReq("hello") },
      { context: ctx() }
    );
    expect(res).toEqual({ result: { text: "hi back" }, cached: false });
  });

  test("a cache hit is free and flagged cached", async () => {
    let calls = 0;
    const { router, ctx, appId } = await harness(async () => {
      calls += 1;
      return { text: "once" };
    });
    await call(router.chat, { appId, request: textReq("q") }, { context: ctx() });
    const second = await call(
      router.chat,
      { appId, request: textReq("q") },
      { context: ctx() }
    );
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  test("rejects an unknown app", async () => {
    const { router, ctx } = await harness(async () => ({ text: "x" }));
    await expect(
      call(
        router.chat,
        { appId: "app_00000000000000000000000000", request: textReq("hi") },
        { context: ctx() }
      )
    ).rejects.toThrow(ORPCError);
  });

  test("enforces the per-app daily quota (cache misses only)", async () => {
    // each prompt is unique → never cached → every call consumes a unit
    let n = 0;
    const { router, ctx, appId } = await harness(async () => {
      n += 1;
      return { text: `r${n}` };
    });
    for (let i = 0; i < AI_CALLS_PER_USER_APP_DAY; i += 1) {
      await call(router.chat, { appId, request: textReq(`p${i}`) }, { context: ctx() });
    }
    await expect(
      call(router.chat, { appId, request: textReq("over") }, { context: ctx() })
    ).rejects.toThrow(/Daily AI limit/);
  });

  test("refunds the quota unit when the model call fails", async () => {
    const { router, ctx, appId } = await harness(async () => {
      throw new Error("model down");
    });
    // Every call fails + refunds, so the counter never exhausts: past the daily
    // cap the error is still "unavailable", never "Daily AI limit".
    for (let i = 0; i < AI_CALLS_PER_USER_APP_DAY + 3; i += 1) {
      await expect(
        call(router.chat, { appId, request: textReq(`x${i}`) }, { context: ctx() })
      ).rejects.toThrow(/unavailable/);
    }
  });
});
