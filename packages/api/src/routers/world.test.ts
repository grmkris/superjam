import { describe, expect, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { schema } from "@superjam/db";
import { createLogger } from "@superjam/logger";
import { eq } from "drizzle-orm";
import {
  createWorldVerifier,
  nullWorldVerifier,
  WorldNotConfiguredError,
  type WorldProof,
  type WorldVerifier,
  type WorldVerifyResult,
} from "../auth/world.ts";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestUser } from "../testing/factories.ts";
import { worldRouter } from "./world.ts";

const logger = createLogger({ level: "silent" });

const PROOF: WorldProof = {
  merkle_root: "0xmerkle",
  nullifier_hash: "0xnullifier-alice",
  proof: "0xproof",
  verification_level: "orb",
};

// A WorldVerifier stub: records the proofs it saw, returns a scripted result.
const stubWorld = (
  result: WorldVerifyResult | ((p: WorldProof) => WorldVerifyResult) = (p) => ({
    ok: true,
    nullifierHash: p.nullifier_hash,
    verificationLevel: p.verification_level,
  })
): WorldVerifier & { seen: Array<{ proof: WorldProof; signal?: string }> } => {
  const seen: Array<{ proof: WorldProof; signal?: string }> = [];
  return {
    seen,
    appId: () => "app_staging_test",
    action: () => "publish-app",
    verifyProof({ proof, signal }) {
      seen.push({ proof, signal });
      return Promise.resolve(typeof result === "function" ? result(proof) : result);
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
  test("returns the server-provided app id + action for the widget", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db);
    const token = await signIn(user);
    const res = await call(worldRouter.rpContext, {}, { context: ctxFor(token, stubWorld()) });
    expect(res).toEqual({ appId: "app_staging_test", action: "publish-app" });
  });
});

describe("world.verify", () => {
  test("forwards the proof AS-IS, sets worldVerified + stores the nullifier", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db, { worldVerified: false });
    const token = await signIn(user);
    const world = stubWorld();

    const res = await call(
      worldRouter.verify,
      { proof: PROOF },
      { context: ctxFor(token, world) }
    );
    expect(res.worldVerified).toBe(true);
    expect(res.verificationLevel).toBe("orb");

    // forwarded verbatim
    expect(world.seen).toHaveLength(1);
    expect(world.seen[0]!.proof).toEqual(PROOF);

    const row = await db.query.user.findFirst({
      where: eq(schema.user.id, user.id),
    });
    expect(row!.worldVerified).toBe(true);
    expect(row!.worldNullifierHash).toBe(PROOF.nullifier_hash);
  });

  test("passes a signal through to the verifier when present", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db);
    const token = await signIn(user);
    const world = stubWorld();
    await call(
      worldRouter.verify,
      { proof: PROOF, signal: "0xsignal" },
      { context: ctxFor(token, world) }
    );
    expect(world.seen[0]!.signal).toBe("0xsignal");
  });

  test("rejects a failed World verification with BAD_REQUEST", async () => {
    const { db, ctxFor, signIn } = await harness();
    const user = await createTestUser(db);
    const token = await signIn(user);
    const world = stubWorld({ ok: false, code: "invalid_proof", detail: "nope" });
    await expect(
      call(worldRouter.verify, { proof: PROOF }, { context: ctxFor(token, world) })
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
      { proof: PROOF },
      { context: ctxFor(await signIn(alice), stubWorld()) }
    );

    // Bob presents a proof that resolves to the SAME nullifier → refused.
    await expect(
      call(
        worldRouter.verify,
        { proof: PROOF },
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
    await call(worldRouter.verify, { proof: PROOF }, { context: ctxFor(token, stubWorld()) });
    const res = await call(
      worldRouter.verify,
      { proof: PROOF },
      { context: ctxFor(token, stubWorld()) }
    );
    expect(res.worldVerified).toBe(true);
  });

  test("requires authentication", async () => {
    const { ctxFor } = await harness();
    await expect(
      call(worldRouter.verify, { proof: PROOF }, { context: ctxFor(undefined, stubWorld()) })
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

const okResponse = () =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("createWorldVerifier (live seam)", () => {
  test("POSTs the proof as-is to /api/v4/verify/{rp_id} and returns ok", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      });
      return okResponse();
    }) as unknown as typeof fetch;

    const v = createWorldVerifier({
      appId: "app_abc",
      action: "publish-app",
      fetchImpl,
    });
    const res = await v.verifyProof({ proof: PROOF, signal: "0xsig" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.nullifierHash).toBe(PROOF.nullifier_hash);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://developer.world.org/api/v4/verify/app_abc");
    expect(calls[0]!.body).toEqual({
      ...PROOF,
      action: "publish-app",
      signal: "0xsig",
    });
  });

  test("maps a non-ok / success:false response to a failure result", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: "invalid_proof", detail: "bad" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const v = createWorldVerifier({ appId: "app_abc", fetchImpl });
    const res = await v.verifyProof({ proof: PROOF });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("invalid_proof");
      expect(res.detail).toBe("bad");
    }
  });

  test("degrades to the keyless null verifier with no app id", async () => {
    const v = createWorldVerifier({});
    expect(v).toBe(nullWorldVerifier);
    await expect(v.verifyProof({ proof: PROOF })).rejects.toBeInstanceOf(
      WorldNotConfiguredError
    );
  });
});
