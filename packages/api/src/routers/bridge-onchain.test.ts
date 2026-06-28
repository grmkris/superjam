// bridge.onchain (§ builder-deploys-contracts) — read = view call, write =
// operator-relayed with the player STAMPED server-side + the target PINNED to
// the app's own contract. The jam never supplies "who" or "which address".
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
import { createTestApp } from "../testing/factories.ts";

setDefaultTimeout(20_000);

const logger = createLogger({ level: "silent" });
const WALLET = "0x000000000000000000000000000000000000aaaa" as Address;
const CONTRACT = "0x00000000000000000000000000000000000c0ffe" as Address;
const ABI = [
  {
    type: "function",
    name: "flip",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "guess", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "statsOf",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "won", type: "uint256" }],
  },
] as const;

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

const seedApp = (over: Partial<typeof schema.app.$inferInsert> = {}) => {
  const { ownerUserId, ...rest } = over;
  // Route through the shared factory so ownerUserId stays the branded UserId type
  // (the inline `?? "user_x"` widened it to string → broke the .values() overload).
  return createTestApp(
    db,
    (ownerUserId ?? "user_x") as Parameters<typeof createTestApp>[1],
    {
      slug: "coinflip",
      name: "Coinflip",
      capabilities: ["onchain"],
      gameContractAddress: CONTRACT,
      gameContractAbi: ABI as unknown as readonly unknown[],
      ...rest,
    }
  );
};

describe("bridge.onchain.write", () => {
  test("stamps the player as arg 0 + pins the target to the app's contract", async () => {
    const { user, token } = await seedUser();
    const app = await seedApp({ ownerUserId: user.id });
    const res = await call(
      appRouter.bridge.onchain.write,
      { appId: app.id, fn: "flip", args: [1] } as never,
      { context: await ctxFor(token) }
    );
    expect(res.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(onchain.gameWrites).toHaveLength(1);
    expect(onchain.gameWrites[0]!.address).toBe(CONTRACT);
    expect(onchain.gameWrites[0]!.functionName).toBe("flip");
    // arg 0 is the verified wallet (stamped), not anything the jam passed.
    expect(onchain.gameWrites[0]!.args).toEqual([WALLET, 1]);
  });

  test("a jam with no deployed contract → BAD_REQUEST", async () => {
    const { user, token } = await seedUser();
    const app = await seedApp({
      ownerUserId: user.id,
      gameContractAddress: null,
      gameContractAbi: null,
    });
    await expect(
      call(
        appRouter.bridge.onchain.write,
        { appId: app.id, fn: "flip", args: [1] } as never,
        { context: await ctxFor(token) }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("a user with no wallet on file → BAD_REQUEST", async () => {
    const { user, token } = await seedUser({ walletAddress: null });
    const app = await seedApp({ ownerUserId: user.id });
    await expect(
      call(
        appRouter.bridge.onchain.write,
        { appId: app.id, fn: "flip", args: [1] } as never,
        { context: await ctxFor(token) }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("bridge.onchain.read", () => {
  test("view call returns the decoded result with bigints stringified", async () => {
    const { user, token } = await seedUser();
    const app = await seedApp({ ownerUserId: user.id });
    onchain.setGameRead(() => 5n);
    const res = await call(
      appRouter.bridge.onchain.read,
      { appId: app.id, fn: "statsOf", args: [WALLET] } as never,
      { context: await ctxFor(token) }
    );
    expect(res).toBe("5");
  });
});
