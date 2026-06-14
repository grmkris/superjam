// payments private rail (§23) — enablePrivacy / privateBalance / depositPrivate /
// privateSend, over a mock UnlinkService (the real per-user Unlink rail is proven
// live in packages/onchain/integration/unlink.itest.ts).
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { call } from "@orpc/server";
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import type { Onchain } from "@superjam/onchain";
import { type Usdc, parseUsdc, usdc } from "@superjam/onchain";
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import type { UnlinkService } from "../services/unlink-service.ts";
import { createMockOnchain } from "../testing/onchain-mock.ts";
import { createExternalApp } from "./apps.ts";

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

const ctxFor = (
  token?: string,
  unlink: UnlinkService = mock.svc,
  onchain?: Onchain
) =>
  createContext({
    db,
    logger,
    auth: auth.verifier,
    rateLimiter: createRateLimiter(),
    unlink,
    ...(onchain ? { onchain } : {}),
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

  test("a friend @send records a 'tip' chat money-line server-side", async () => {
    const sender = await seedUser({ username: "alice", dynamicUserId: "dyn_alice" });
    await seedUser({
      username: "bob",
      dynamicUserId: "dyn_bob",
      unlinkAddress: "unlink1bob",
    });
    await call(appRouter.friends.add, { username: "bob" }, {
      context: ctxFor(sender.token),
    });
    await call(appRouter.payments.depositPrivate, { amount: "1.00" }, {
      context: ctxFor(sender.token),
    });
    await call(appRouter.payments.privateSend, { to: "@bob", amount: "0.25" }, {
      context: ctxFor(sender.token),
    });
    const hist = await call(appRouter.chat.history, { withUsername: "bob" }, {
      context: ctxFor(sender.token),
    });
    expect(hist.messages[0]!.kind).toBe("tip");
    expect(hist.messages[0]!.amountUsdc).toBe("0.25");
  });

  test("an appTreasury tip lands in the app owner's shielded balance", async () => {
    const sender = await seedUser({ username: "alice", dynamicUserId: "dyn_alice" });
    const owner = await seedUser({ username: "owner", dynamicUserId: "dyn_owner" });
    const app = await createExternalApp(db, {
      manifest: {
        name: "Tipjar",
        slug: "tipjar",
        description: "tips",
        iconEmoji: "💸",
        category: "game",
        capabilities: ["payments"],
      },
      entryUrl: "https://tipjar.vercel.app",
      ownerUserId: owner.user.id,
    });
    await call(appRouter.payments.depositPrivate, { amount: "1.00" }, {
      context: ctxFor(sender.token),
    });
    const res = await call(
      appRouter.payments.privateSend,
      { to: "appTreasury", appId: app.id, amount: "0.50" },
      { context: ctxFor(sender.token) }
    );
    expect(res.txHash).toBe(HASH);
    // owner had no unlinkAddress → auto-provisioned to unlink1<ownerId>
    expect(mock.transfers.at(-1)!.to).toBe(mock.addr(owner.user.id));
  });
});

describe("payments.addFunds", () => {
  test("Arc rail credits the shielded balance instantly (no bridge)", async () => {
    const { user, token } = await seedUser();
    const res = await call(
      appRouter.payments.addFunds,
      { sourceChain: "arcTestnet", amount: "1.00" },
      { context: ctxFor(token) }
    );
    expect(res.burnTxHash).toBeNull();
    expect(res.mintTxHash).toBeNull();
    expect(mock.faucets.at(-1)).toEqual({
      to: mock.addr(user.id),
      amount: parseUsdc("1.00"),
    });
  });

  test("Sepolia rail: CCTP-fast mints to the user, then deposits to their confidential balance", async () => {
    const onchain = createMockOnchain({ unlinkAvailable: true });
    const { user, token } = await seedUser();
    const res = await call(
      appRouter.payments.addFunds,
      { sourceChain: "sepolia", amount: "1.00" },
      { context: ctxFor(token, mock.svc, onchain) }
    );
    // bridge mints to the USER's own wallet (the same dollars flow through)
    expect(onchain.bridges).toHaveLength(1);
    expect(onchain.bridges[0]).toMatchObject({
      amount: parseUsdc("1.00"),
      mintRecipient: WALLET,
      fast: true,
    });
    expect(res.burnTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.mintTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    // swap-into-confidential = a deposit to the user (NOT a pool faucet)
    expect(mock.faucets).toHaveLength(0);
    expect(res.shieldedUsdc).toBe("1");
  });

  test("over the per-tx cap is rejected", async () => {
    const { token } = await seedUser();
    await expect(
      call(appRouter.payments.addFunds, { sourceChain: "arcTestnet", amount: "100000" }, {
        context: ctxFor(token),
      })
    ).rejects.toBeDefined();
  });
});
