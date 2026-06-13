// sdk.pot verification matrix (§9/§19): stake receipt verified to escrow;
// pro-rata payout; per-stake idempotency (no double-pay); double-resolve →
// CONFLICT; non-creator resolve → FORBIDDEN; AI-oracle resolve.
import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@superjam/db";
import { createPgliteDb } from "@superjam/db/pglite";
import { type Usdc, parseUsdc } from "@superjam/onchain";
import type { Address, Hex } from "viem";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import { createMockOnchain } from "../testing/onchain-mock.ts";
import { createPotService } from "./pot-service.ts";

const oracle = (option: string) => ({
  resolve: async () => ({ option }),
});

const A = "0x000000000000000000000000000000000000aaaa" as Address;
const B = "0x000000000000000000000000000000000000bbbb" as Address;
let n = 0;
const hash = (): Hex => `0x${(++n).toString(16).padStart(64, "0")}` as Hex;

let db: Database;
beforeEach(async () => {
  ({ db } = await createPgliteDb());
});

const scope = async () => {
  const creator = await createTestUser(db);
  const alice = await createTestUser(db, { walletAddress: A });
  const bob = await createTestUser(db, { walletAddress: B });
  const app = await createTestApp(db, creator.id);
  return { creator, alice, bob, appId: app.id };
};

// Stake helper — point the mock verifier at this staker/amount, then stake.
const stake = async (
  svc: ReturnType<typeof createPotService>,
  onchain: ReturnType<typeof createMockOnchain>,
  appId: string,
  potId: string,
  actor: { id: string; walletAddress: Address },
  option: string,
  amount: Usdc
) => {
  onchain.setVerify(async () => ({ from: actor.walletAddress, value: amount }));
  return svc.stake(appId as never, actor as never, {
    potId: potId as never,
    option,
    txHash: hash(),
  });
};

describe("pot-service", () => {
  test("stake verifies to escrow; resolve pays winners pro-rata", async () => {
    const { creator, alice, bob, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("yes") });

    const pot = await svc.create(appId as never, creator.id, {
      question: "Will it ship?",
      options: ["yes", "no"],
    });
    await stake(svc, onchain, appId, pot.id, alice as never, "yes", parseUsdc("1"));
    await stake(svc, onchain, appId, pot.id, bob as never, "no", parseUsdc("2"));

    const res = await svc.resolve(appId as never, creator.id, {
      potId: pot.id,
      resolvedOption: "yes",
    });
    expect(res.resolvedOption).toBe("yes");
    // Whole 3 USDC pool → Alice (sole winner). Bob (loser) gets nothing.
    expect(onchain.sends).toHaveLength(1);
    expect(onchain.sends[0]!.to).toBe(A);
    expect(onchain.sends[0]!.value).toBe(parseUsdc("3"));
  });

  test("payout is idempotent — re-running pays nobody twice", async () => {
    const { creator, alice, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("yes") });
    const pot = await svc.create(appId as never, creator.id, {
      question: "q",
      options: ["yes", "no"],
    });
    await stake(svc, onchain, appId, pot.id, alice as never, "yes", parseUsdc("1"));
    await svc.resolve(appId as never, creator.id, {
      potId: pot.id,
      resolvedOption: "yes",
    });
    expect(onchain.sends).toHaveLength(1);
    // Re-invoke payout directly (simulates a retry/sweep) — no new sends.
    await svc.payout(pot.id as never);
    expect(onchain.sends).toHaveLength(1);
  });

  test("double-resolve → CONFLICT", async () => {
    const { creator, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("yes") });
    const pot = await svc.create(appId as never, creator.id, {
      question: "q",
      options: ["yes", "no"],
    });
    await svc.resolve(appId as never, creator.id, {
      potId: pot.id,
      resolvedOption: "yes",
    });
    await expect(
      svc.resolve(appId as never, creator.id, {
        potId: pot.id,
        resolvedOption: "no",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("non-creator resolve → FORBIDDEN", async () => {
    const { creator, alice, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("yes") });
    const pot = await svc.create(appId as never, creator.id, {
      question: "q",
      options: ["yes", "no"],
    });
    await expect(
      svc.resolve(appId as never, alice.id, {
        potId: pot.id,
        resolvedOption: "yes",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("AI-oracle resolve (no explicit outcome) picks + pays the winner", async () => {
    const { creator, alice, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("no") });
    const pot = await svc.create(appId as never, creator.id, {
      question: "q",
      options: ["yes", "no"],
    });
    await stake(svc, onchain, appId, pot.id, alice as never, "no", parseUsdc("1"));
    const res = await svc.resolve(appId as never, creator.id, { potId: pot.id });
    expect(res.resolvedOption).toBe("no"); // from the oracle
    expect(onchain.sends).toHaveLength(1);
  });

  test("reused stake txHash → CONFLICT (replay guard)", async () => {
    const { creator, alice, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("yes") });
    const pot = await svc.create(appId as never, creator.id, {
      question: "q",
      options: ["yes", "no"],
    });
    onchain.setVerify(async () => ({ from: A, value: parseUsdc("1") }));
    const tx = hash();
    await svc.stake(appId as never, alice as never, {
      potId: pot.id as never,
      option: "yes",
      txHash: tx,
    });
    await expect(
      svc.stake(appId as never, alice as never, {
        potId: pot.id as never,
        option: "yes",
        txHash: tx,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("stake from a wallet that isn't yours → BAD_REQUEST", async () => {
    const { creator, alice, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("yes") });
    const pot = await svc.create(appId as never, creator.id, {
      question: "q",
      options: ["yes", "no"],
    });
    // Verifier reports the funds came from B, but Alice is staking.
    onchain.setVerify(async () => ({ from: B, value: parseUsdc("1") }));
    await expect(
      svc.stake(appId as never, alice as never, {
        potId: pot.id as never,
        option: "yes",
        txHash: hash(),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("no-winner pot refunds every staker their own stake", async () => {
    const { creator, alice, bob, appId } = await scope();
    const onchain = createMockOnchain();
    const svc = createPotService({ db, onchain, oracle: oracle("yes") });
    const pot = await svc.create(appId as never, creator.id, {
      question: "q",
      options: ["yes", "no", "maybe"],
    });
    await stake(svc, onchain, appId, pot.id, alice as never, "yes", parseUsdc("1"));
    await stake(svc, onchain, appId, pot.id, bob as never, "no", parseUsdc("2"));
    // Resolve to an option nobody staked → refund all.
    await svc.resolve(appId as never, creator.id, {
      potId: pot.id,
      resolvedOption: "maybe",
    });
    expect(onchain.sends).toHaveLength(2);
    const byTo = new Map(onchain.sends.map((s) => [s.to, s.value]));
    expect(byTo.get(A)).toBe(parseUsdc("1"));
    expect(byTo.get(B)).toBe(parseUsdc("2"));
  });
});
