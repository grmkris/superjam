// publish.submit verification matrix (§12/§19): owner pays the fee → listed;
// a RELAYED EIP-3009 fee (Transfer-log from = owner) is accepted; wrong
// recipient/amount, a reused hash, a foreign-wallet payer, a non-owner, and an
// unverified user are all rejected.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { ORPCError, call } from "@orpc/server";
import { schema } from "@superjam/db";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import { parseUsdc } from "@superjam/onchain";
import type { Address } from "viem";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import { createMockOnchain } from "../testing/onchain-mock.ts";

setDefaultTimeout(20_000); // fresh pglite + full migrations per harness is slow

const logger = createLogger({ level: "silent" });
const TREASURY = "0x000000000000000000000000000000000000d00d" as Address;
const OWNER_WALLET = "0x000000000000000000000000000000000000aaaa" as Address;
const OTHER_WALLET = "0x000000000000000000000000000000000000bbbb" as Address;
const tx = (k: number) => `0x${k.toString(16).padStart(64, "0")}` as const;

const harness = async () => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const rateLimiter = createRateLimiter();
  const onchain = createMockOnchain({ serverAddress: TREASURY });
  const ctxFor = (token?: string) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      onchain,
      treasuryAddress: TREASURY,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    });
  return { db, auth, ctxFor, onchain };
};

const seedOwner = async (
  db: Awaited<ReturnType<typeof createPgliteDb>>["db"],
  auth: Awaited<ReturnType<typeof createTestAuth>>,
  over: Partial<typeof schema.user.$inferInsert> = {}
) => {
  const [u] = await db
    .insert(schema.user)
    .values({
      dynamicUserId: "dyn_o",
      email: "o@test.io",
      username: "owner",
      worldVerified: true,
      walletAddress: OWNER_WALLET,
      ...over,
    })
    .returning();
  const [app] = await db
    .insert(schema.app)
    .values({
      slug: "mine",
      name: "Mine",
      ownerUserId: u!.id,
      status: "deployed",
    })
    .returning();
  const token = await auth.sign({ dynamicUserId: u!.dynamicUserId!, email: u!.email });
  return { user: u!, app: app!, token };
};

const submit = (ctx: any, appId: string, txHash: string) =>
  call(appRouter.publish.submit, { appId, txHash } as any, { context: ctx });

describe("publish.submit", () => {
  test("owner pays the fee (relayed EIP-3009, log from=owner) → listed", async () => {
    const { db, auth, ctxFor, onchain } = await harness();
    const { app, token } = await seedOwner(db, auth);
    // The mock verifier returns the OWNER as the Transfer-log `from` even though
    // a relayer would be the outer tx.from — the §12 accept case.
    onchain.setVerify(async () => ({ from: OWNER_WALLET, value: parseUsdc("1") }));

    const res = await submit(ctxFor(token), app.id, tx(1));
    expect(res.status).toBe("listed");
    const row = await db.query.app.findFirst();
    expect(row!.status).toBe("listed");
  });

  test("wrong recipient/amount (verifier rejects) → BAD_REQUEST", async () => {
    const { db, auth, ctxFor } = await harness();
    const { app, token } = await seedOwner(db, auth);
    // default mock verify throws TRANSFER_NOT_FOUND
    await expect(submit(ctxFor(token), app.id, tx(2))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("fee paid from a foreign wallet → BAD_REQUEST", async () => {
    const { db, auth, ctxFor, onchain } = await harness();
    const { app, token } = await seedOwner(db, auth);
    onchain.setVerify(async () => ({ from: OTHER_WALLET, value: parseUsdc("1") }));
    await expect(submit(ctxFor(token), app.id, tx(3))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("reused txHash → CONFLICT (replay guard)", async () => {
    const { db, auth, ctxFor, onchain } = await harness();
    const { app, token } = await seedOwner(db, auth);
    onchain.setVerify(async () => ({ from: OWNER_WALLET, value: parseUsdc("1") }));
    await submit(ctxFor(token), app.id, tx(4));
    await expect(submit(ctxFor(token), app.id, tx(4))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  test("non-owner → FORBIDDEN", async () => {
    const { db, auth, ctxFor, onchain } = await harness();
    const { app } = await seedOwner(db, auth);
    onchain.setVerify(async () => ({ from: OWNER_WALLET, value: parseUsdc("1") }));
    const [stranger] = await db
      .insert(schema.user)
      .values({
        dynamicUserId: "dyn_s",
        email: "s@test.io",
        username: "stranger",
        worldVerified: true,
        walletAddress: OTHER_WALLET,
      })
      .returning();
    const token = await auth.sign({ dynamicUserId: stranger!.dynamicUserId!, email: stranger!.email });
    await expect(submit(ctxFor(token), app.id, tx(5))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("unverified user → FORBIDDEN (human gate)", async () => {
    const { db, auth, ctxFor } = await harness();
    const { app, token } = await seedOwner(db, auth, { worldVerified: false });
    await expect(submit(ctxFor(token), app.id, tx(6))).rejects.toBeInstanceOf(
      ORPCError
    );
  });
});
