// payments private rail (§23) — enablePrivacy / privateBalance / depositPrivate /
// privateSend, over a mock UnlinkService (the real per-user Unlink rail is proven
// live in packages/onchain/integration/unlink.itest.ts).
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { call } from "@orpc/server";
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import { type Usdc, parseUsdc, usdc } from "@superjam/onchain";
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import type { UnlinkService } from "../services/unlink-service.ts";

setDefaultTimeout(20_000);

const logger = createLogger({ level: "silent" });
const WALLET = "0x000000000000000000000000000000000000aaaa" as Address;
const HASH = `0x${"c".repeat(64)}` as Hex;

// In-memory UnlinkService: derives unlink1<userId>, tracks balances + transfers.
const makeMockUnlink = () => {
  const balances = new Map<string, bigint>();
  const transfers: { from: string; to: string; amount: Usdc }[] = [];
  const faucets: { to: string; amount: Usdc }[] = [];
  const addr = (userId: string) => `unlink1${userId}`;
  const svc: UnlinkService = {
    available: true,
    enable: async (userId) => ({ unlinkAddress: addr(userId) }),
    balance: async (userId) => usdc(balances.get(userId) ?? 0n),
    deposit: async (userId, amount) => {
      balances.set(userId, (balances.get(userId) ?? 0n) + amount);
      return HASH;
    },
    transfer: async (userId, to, amount) => {
      transfers.push({ from: userId, to, amount });
      balances.set(userId, (balances.get(userId) ?? 0n) - amount);
      return HASH;
    },
    withdraw: async () => HASH,
    faucet: async (to, amount) => {
      faucets.push({ to, amount });
      return HASH;
    },
  };
  return { svc, balances, transfers, faucets, addr };
};

let db: Database;
let auth: Awaited<ReturnType<typeof createTestAuth>>;
let mock: ReturnType<typeof makeMockUnlink>;
beforeEach(async () => {
  ({ db } = await createPgliteDb());
  auth = await createTestAuth();
  mock = makeMockUnlink();
});

const ctxFor = (token?: string, unlink: UnlinkService = mock.svc) =>
  createContext({
    db,
    logger,
    auth: auth.verifier,
    rateLimiter: createRateLimiter(),
    unlink,
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
  });

const seedUser = async (over: Partial<typeof schema.user.$inferInsert> = {}) => {
  const [u] = await db
    .insert(schema.user)
    .values({
      dynamicUserId: `dyn_${over.username ?? "user"}`,
      email: `${over.username ?? "user"}@test.io`,
      username: "user",
      walletAddress: WALLET,
      ...over,
    })
    .returning();
  const token = await auth.sign({ dynamicUserId: u!.dynamicUserId!, email: u!.email });
  return { user: u!, token };
};

describe("payments.enablePrivacy", () => {
  test("derives + persists the caller's unlinkAddress", async () => {
    const { user, token } = await seedUser();
    const res = await call(appRouter.payments.enablePrivacy, undefined, {
      context: ctxFor(token),
    });
    expect(res.unlinkAddress).toBe(mock.addr(user.id));
    const row = await db.query.user.findFirst({ where: eq(schema.user.id, user.id) });
    expect(row?.unlinkAddress).toBe(mock.addr(user.id));
  });

  test("degraded service ⇒ clean error (not a crash)", async () => {
    const { token } = await seedUser();
    const { nullUnlinkService } = await import("../services/unlink-service.ts");
    await expect(
      call(appRouter.payments.enablePrivacy, undefined, {
        context: ctxFor(token, nullUnlinkService),
      })
    ).rejects.toBeDefined();
  });
});

describe("payments.ensurePrivacy (no-toggle auto-provision + welcome faucet)", () => {
  test("provisions + grants the 2-USDC welcome faucet once", async () => {
    const { user, token } = await seedUser();
    const res = await call(appRouter.payments.ensurePrivacy, undefined, {
      context: ctxFor(token),
    });
    expect(res.unlinkAddress).toBe(mock.addr(user.id));
    expect(res.welcomeFauceted).toBe(true);
    expect(mock.faucets.at(-1)).toEqual({
      to: mock.addr(user.id),
      amount: parseUsdc("2"),
    });
    // second call is idempotent — no second faucet (lastTopupAt now set).
    const again = await call(appRouter.payments.ensurePrivacy, undefined, {
      context: ctxFor(token),
    });
    expect(again.welcomeFauceted).toBe(false);
    expect(mock.faucets).toHaveLength(1);
  });
});

describe("payments.depositPrivate + privateBalance", () => {
  test("deposit funds the shielded balance; balance reflects it", async () => {
    const { token } = await seedUser();
    await call(appRouter.payments.depositPrivate, { amount: "0.10" }, {
      context: ctxFor(token),
    });
    const res = await call(appRouter.payments.privateBalance, undefined, {
      context: ctxFor(token),
    });
    expect(res.shieldedUsdc).toBe("0.1");
  });

  test("deposit over the per-tx cap is rejected", async () => {
    const { token } = await seedUser();
    await expect(
      call(appRouter.payments.depositPrivate, { amount: "100000" }, {
        context: ctxFor(token),
      })
    ).rejects.toBeDefined();
  });
});

describe("payments.privateSend", () => {
  test("sub-cent (0.001) private send to a @friend transfers exactly", async () => {
    const sender = await seedUser({ username: "alice", dynamicUserId: "dyn_alice" });
    const friend = await seedUser({
      username: "bob",
      dynamicUserId: "dyn_bob",
      unlinkAddress: "unlink1bob",
    });
    // fund the sender's shielded balance first
    await call(appRouter.payments.depositPrivate, { amount: "1.00" }, {
      context: ctxFor(sender.token),
    });
    const res = await call(
      appRouter.payments.privateSend,
      { to: "@bob", amount: "0.001" },
      { context: ctxFor(sender.token) }
    );
    expect(res.txHash).toBe(HASH);
    const t = mock.transfers.at(-1)!;
    expect(t.from).toBe(sender.user.id);
    expect(t.to).toBe("unlink1bob"); // the recipient's seeded unlinkAddress
    expect(t.amount).toBe(parseUsdc("0.001"));
  });

  test("send to an unknown @user is rejected", async () => {
    const { token } = await seedUser({ username: "alice", dynamicUserId: "dyn_alice" });
    await expect(
      call(appRouter.payments.privateSend, { to: "@ghost", amount: "0.01" }, {
        context: ctxFor(token),
      })
    ).rejects.toBeDefined();
  });
});
