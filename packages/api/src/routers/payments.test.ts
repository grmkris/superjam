// payments.relay (gasless EIP-3009 transport) + profile.topup (both rails,
// 1/day) — §12/§13/§15.1.
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { call } from "@orpc/server";
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import type { Address } from "viem";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import { createMockOnchain } from "../testing/onchain-mock.ts";

setDefaultTimeout(20_000);

const logger = createLogger({ level: "silent" });
const WALLET = "0x000000000000000000000000000000000000aaaa" as Address;
const OTHER = "0x000000000000000000000000000000000000bbbb" as Address;
const nonce = `0x${"1".repeat(64)}`;
const SIG = `0x${"ab".repeat(65)}`; // a well-formed 65-byte EIP-712 signature
const nowSec = () => Math.floor(Date.now() / 1000);

let db: Database;
let auth: Awaited<ReturnType<typeof createTestAuth>>;
let onchain: ReturnType<typeof createMockOnchain>;
beforeEach(async () => {
  ({ db } = await createPgliteDb());
  auth = await createTestAuth();
  onchain = createMockOnchain();
});

const ctxFor = (token?: string) =>
  createContext({
    db,
    logger,
    auth: auth.verifier,
    rateLimiter: createRateLimiter(),
    onchain,
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
  });

const seedUser = async (over: Partial<typeof schema.user.$inferInsert> = {}) => {
  const [u] = await db
    .insert(schema.user)
    .values({
      dynamicUserId: "dyn_u",
      email: "u@test.io",
      username: "user",
      walletAddress: WALLET,
      ...over,
    })
    .returning();
  const token = await auth.sign({ dynamicUserId: u!.dynamicUserId!, email: u!.email });
  return { user: u!, token };
};

const auth3009 = (over: Partial<Record<string, string>> = {}) => ({
  from: WALLET,
  to: OTHER,
  value: "1000000", // 1 USDC base units
  validAfter: "0",
  validBefore: String(nowSec() + 3600),
  nonce,
  ...over,
});

const relay = (ctx: any, authorization: any) =>
  call(appRouter.payments.relay, { authorization, signature: SIG } as any, {
    context: ctx,
  });

describe("payments.relay", () => {
  test("relays a valid authorization → real tx hash", async () => {
    const { token } = await seedUser();
    const res = await relay(ctxFor(token), auth3009());
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("over the per-tx cap → BAD_REQUEST", async () => {
    const { token } = await seedUser();
    await expect(
      relay(ctxFor(token), auth3009({ value: "26000000" }))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("expired authorization → BAD_REQUEST", async () => {
    const { token } = await seedUser();
    await expect(
      relay(ctxFor(token), auth3009({ validBefore: String(nowSec() - 5) }))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("authorization from a foreign wallet → FORBIDDEN", async () => {
    const { token } = await seedUser();
    await expect(
      relay(ctxFor(token), auth3009({ from: OTHER }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("payments.balance", () => {
  test("returns the public USDC balance for a wallet'd user", async () => {
    const { token } = await seedUser();
    const res = await call(appRouter.payments.balance, undefined, {
      context: ctxFor(token),
    });
    expect(res.publicUsdc).toBe("0"); // mock usdcBalance returns 0
  });

  test("no wallet ⇒ null (UI shows —, never errors)", async () => {
    const { token } = await seedUser({ walletAddress: null });
    const res = await call(appRouter.payments.balance, undefined, {
      context: ctxFor(token),
    });
    expect(res.publicUsdc).toBeNull();
  });

  test("unconfigured onchain ⇒ null, not an error", async () => {
    const { token } = await seedUser();
    // A context with the default (degraded) onchain — usdcBalance rejects.
    const ctx = createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter: createRateLimiter(),
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
    const res = await call(appRouter.payments.balance, undefined, { context: ctx });
    expect(res.publicUsdc).toBeNull();
  });
});

describe("profile.topup", () => {
  test("world-verified user tops up; second tap same day → QUOTA_EXCEEDED", async () => {
    const { token } = await seedUser({ worldVerified: true });
    const res = await call(appRouter.profile.topup, undefined, {
      context: ctxFor(token),
    });
    expect(res.publicTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(onchain.sends).toHaveLength(1);
    expect(onchain.sends[0]!.to).toBe(WALLET);

    await expect(
      call(appRouter.profile.topup, undefined, { context: ctxFor(token) })
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  test("unverified user → FORBIDDEN (human gate)", async () => {
    const { token } = await seedUser({ worldVerified: false });
    await expect(
      call(appRouter.profile.topup, undefined, { context: ctxFor(token) })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("payments.resolveRecipient", () => {
  test("@username → that user's wallet; 0x passes through; appTreasury → owner wallet", async () => {
    const { token } = await seedUser(); // "user" @ WALLET
    // pay a friend
    const friend = await call(
      appRouter.payments.resolveRecipient,
      { to: "@user" },
      { context: ctxFor(token) }
    );
    expect(friend.address.toLowerCase()).toBe(WALLET.toLowerCase());

    // raw address passthrough
    const passthrough = await call(
      appRouter.payments.resolveRecipient,
      { to: OTHER },
      { context: ctxFor(token) }
    );
    expect(passthrough.address.toLowerCase()).toBe(OTHER.toLowerCase());

    // tip → app treasury falls back to the owner's wallet
    const me = await db.query.user.findFirst({
      where: (t, { eq: e }) => e(t.username, "user"),
    });
    const [a] = await db
      .insert(schema.app)
      .values({
        slug: "tip-jar",
        name: "Tip Jar",
        ownerUserId: me!.id,
        status: "deployed",
      })
      .returning();
    const tip = await call(
      appRouter.payments.resolveRecipient,
      { to: "appTreasury", appId: a!.id },
      { context: ctxFor(token) }
    );
    expect(tip.address.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  test("unknown @handle → BAD_REQUEST", async () => {
    const { token } = await seedUser();
    await expect(
      call(
        appRouter.payments.resolveRecipient,
        { to: "@ghost" },
        { context: ctxFor(token) }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
