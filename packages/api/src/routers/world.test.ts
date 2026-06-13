import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import { eq } from "drizzle-orm";
import {
  createWorldVerifier,
  nullWorldVerifier,
  WorldNotConfiguredError,
  type WorldProofV4,
  type WorldVerifier,
  type WorldVerifyResult,
} from "../auth/world.ts";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestUser } from "../testing/factories.ts";
import { worldRouter } from "./world.ts";

// pglite-backed harness flakes on the default 5s under multi-agent CPU load.
setDefaultTimeout(20_000);

const logger = createLogger({ level: "silent" });

// A v4 IDKit result (IDKitResultV4). The RP-scoped nullifier rides in responses[].
const RESULT: WorldProofV4 = {
  protocol_version: "4.0",
  nonce: "0xnonce",
  action: "publish-app",
  environment: "staging",
  responses: [
    {
      identifier: "proof_of_human",
      proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
      nullifier: "0xnullifier-alice",
      issuer_schema_id: 1,
      expires_at_min: 0,
    },
  ],
};
const nullifierOf = (r: WorldProofV4) => r.responses[0]!.nullifier;

// A WorldVerifier stub: records the results it saw, returns a scripted verdict.
const stubWorld = (
  result:
    | WorldVerifyResult
    | ((r: WorldProofV4) => WorldVerifyResult) = (r) => ({
    ok: true,
    nullifierHash: nullifierOf(r),
    verificationLevel: r.responses[0]!.identifier,
  })
): WorldVerifier & { seen: WorldProofV4[] } => {
  const seen: WorldProofV4[] = [];
  return {
    seen,
    appId: () => "app_abc",
    action: () => "publish-app",
    rpContext: () => ({
      appId: "app_abc",
      action: "publish-app",
      environment: "staging",
      allowLegacyProofs: true,
      rpContext: {
        rp_id: "rp_abc",
        nonce: "0xn",
        created_at: 1,
        expires_at: 2,
        signature: "0xsig",
      },
    }),
    verifyProof({ result: r }) {
      seen.push(r);
      return Promise.resolve(typeof result === "function" ? result(r) : result);
    },
  };
};

const harness = async () => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const rateLimiter = createRateLimiter();
  const ctxFor = (token: string | undefined, world: WorldVerifier) => ({
    ...createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    world,
  });
  const signIn = (u: { dynamicUserId: string | null; email: string }) =>
    auth.sign({ dynamicUserId: u.dynamicUserId!, email: u.email });
  return { db, ctxFor, signIn };
};

describe("world.rpContext", () => {
  test("returns the server-signed context (app_id + action + rp_context) for the widget", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db);
    const token = await signIn(user);
    const res = await call(worldRouter.rpContext, {}, { context: ctxFor(token, stubWorld()) });
    expect(res.appId).toBe("app_abc");
    expect(res.action).toBe("publish-app");
    expect(res.rpContext.rp_id).toBe("rp_abc");
    expect(res.allowLegacyProofs).toBe(true);
  });
});

describe("world.verify", () => {
  test("forwards the result AS-IS, sets worldVerified + stores the nullifier", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db, { worldVerified: false });
    const token = await signIn(user);
    const world = stubWorld();

    const res = await call(
      worldRouter.verify,
      { result: RESULT },
      { context: ctxFor(token, world) }
    );
    expect(res.worldVerified).toBe(true);
    expect(res.verificationLevel).toBe("proof_of_human");

    // forwarded verbatim
    expect(world.seen).toHaveLength(1);
    expect(world.seen[0]!).toEqual(RESULT);

    const row = await db.query.user.findFirst({
      where: eq(schema.user.id, user.id),
    });
    expect(row!.worldVerified).toBe(true);
    expect(row!.worldNullifierHash).toBe(nullifierOf(RESULT));
  });

  test("rejects a failed World verification with BAD_REQUEST", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db);
    const token = await signIn(user);
    const world = stubWorld({ ok: false, code: "invalid_proof", detail: "nope" });
    await expect(
      call(worldRouter.verify, { result: RESULT }, { context: ctxFor(token, world) })
    ).rejects.toBeInstanceOf(ORPCError);
    const row = await db.query.user.findFirst({
      where: eq(schema.user.id, user.id),
    });
    expect(row!.worldVerified).toBe(false);
  });

  test("one human = one account: a nullifier on another user is a CONFLICT", async () => {
    const { db, ctxFor, signIn } = await harness();
    const alice = await createTestUser(db);
    const bob = await createTestUser(db);

    // Alice verifies first, claiming the nullifier.
    await call(
      worldRouter.verify,
      { result: RESULT },
      { context: ctxFor(await signIn(alice), stubWorld()) }
    );

    // Bob presents a proof that resolves to the SAME nullifier → refused.
    await expect(
      call(
        worldRouter.verify,
        { result: RESULT },
        { context: ctxFor(await signIn(bob), stubWorld()) }
      )
    ).rejects.toBeInstanceOf(ORPCError);

    const bobRow = await db.query.user.findFirst({
      where: eq(schema.user.id, bob.id),
    });
    expect(bobRow!.worldVerified).toBe(false);
  });

  test("idempotent: the same user re-verifying with the same nullifier is ok", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db);
    const token = await signIn(user);
    await call(worldRouter.verify, { result: RESULT }, { context: ctxFor(token, stubWorld()) });
    const res = await call(
      worldRouter.verify,
      { result: RESULT },
      { context: ctxFor(token, stubWorld()) }
    );
    expect(res.worldVerified).toBe(true);
  });

  test("requires authentication", async () => {
    const { ctxFor } = await harness();
    await expect(
      call(worldRouter.verify, { result: RESULT }, { context: ctxFor(undefined, stubWorld()) })
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

const okResponse = () =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// A valid secp256k1 test key (standard Ethereum example key) for signRequest.
const TEST_KEY =
  "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";

describe("createWorldVerifier (live seam)", () => {
  test("POSTs the v4 result as-is to /api/v4/verify/{rp_id} and returns ok", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return okResponse();
    }) as unknown as typeof fetch;

    const v = createWorldVerifier({
      appId: "app_abc",
      rpId: "rp_abc",
      signingKeyHex: TEST_KEY,
      action: "publish-app",
      fetchImpl,
    });
    const res = await v.verifyProof({ result: RESULT });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.nullifierHash).toBe(nullifierOf(RESULT));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://developer.world.org/api/v4/verify/rp_abc");
    expect(calls[0]!.body).toEqual(RESULT);
  });

  test("rpContext signs a fresh context (rp_id + nonce + signature)", async () => {
    const v = createWorldVerifier({
      appId: "app_abc",
      rpId: "rp_abc",
      signingKeyHex: TEST_KEY,
      action: "publish-app",
      environment: "staging",
    });
    const ctx = v.rpContext();
    expect(ctx.appId).toBe("app_abc");
    expect(ctx.environment).toBe("staging");
    expect(ctx.rpContext.rp_id).toBe("rp_abc");
    expect(ctx.rpContext.nonce).toBeTruthy();
    expect(ctx.rpContext.signature).toBeTruthy();
    // fresh nonce each call
    expect(v.rpContext().rpContext.nonce).not.toBe(ctx.rpContext.nonce);
  });

  test("maps a non-ok / success:false response to a failure result", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: "invalid_proof", detail: "bad" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const v = createWorldVerifier({
      appId: "app_abc",
      rpId: "rp_abc",
      signingKeyHex: TEST_KEY,
      fetchImpl,
    });
    const res = await v.verifyProof({ result: RESULT });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("invalid_proof");
      expect(res.detail).toBe("bad");
    }
  });

  test("degrades to the keyless null verifier without app/rp/key", async () => {
    const v = createWorldVerifier({ appId: "app_abc" }); // missing rpId + key
    expect(v).toBe(nullWorldVerifier);
    await expect(v.verifyProof({ result: RESULT })).rejects.toBeInstanceOf(
      WorldNotConfiguredError
    );
    expect(() => v.rpContext()).toThrow(WorldNotConfiguredError);
  });
});
