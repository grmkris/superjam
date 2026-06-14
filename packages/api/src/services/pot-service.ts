// sdk.pot — escrowed social wagers (§9). Escrow custodian = the agent server
// wallet (onchain.serverAddress). Stakes are verified on the public rail by
// their Transfer receipt to the escrow (the publish.submit shape). resolve()
// is creator-only, sets the outcome (explicit or AI-oracle), then runs an
// idempotent pro-rata payout: each winning stake's `paidOutTxHash` gates its
// payout so retries/sweeps never double-pay (§9). No winner ⇒ every stake is
// refunded (proRata over the full pool returns each staker's own stake).
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  DEMO_MODE,
  POT_STAKE_MAX_USDC,
  POT_TOTAL_MAX_USDC,
  type TypeId,
  fakeTxHash,
} from "@superjam/shared";
import {
  type Onchain,
  PUBLIC_CHAIN,
  USDC,
  type Usdc,
  formatUsdc,
  parseUsdc,
  proRata,
  sumUsdc,
  usdc,
} from "@superjam/onchain";
import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { isAddressEqual, type Hex } from "viem";
import { isUniqueViolation } from "../lib/db-errors.ts";
import type { PotOracle } from "../lib/oracle.ts";

const { pot, potStake, user } = schema;

type PotId = TypeId<"pot">;
type UserId = TypeId<"user">;
type AppId = TypeId<"app">;

const MIN_STAKE: Usdc = usdc(1n); // > 0; the real floor is the cap above
const POT_STAKE_MAX: Usdc = parseUsdc(POT_STAKE_MAX_USDC);
const POT_TOTAL_MAX: Usdc = parseUsdc(POT_TOTAL_MAX_USDC);

export interface PotActor {
  id: UserId;
  walletAddress: string | null;
}

export interface CreatePotInput {
  question: string;
  options: string[];
  deadline?: Date;
}

export const createPotService = ({
  db,
  onchain,
  oracle,
}: {
  db: Database;
  onchain: Onchain;
  oracle: PotOracle;
}) => {
  const loadPot = async (appId: AppId, potId: PotId) => {
    const row = await db.query.pot.findFirst({ where: eq(pot.id, potId) });
    if (!row || row.appId !== appId) {
      throw new ORPCError("NOT_FOUND", { message: "Pot not found" });
    }
    return row;
  };

  const stakesOf = (potId: PotId) =>
    db.select().from(potStake).where(eq(potStake.potId, potId));

  return {
    async create(appId: AppId, creatorUserId: UserId, input: CreatePotInput) {
      const options = input.options
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      if (new Set(options).size < 2) {
        throw new ORPCError("BAD_REQUEST", {
          message: "A pot needs at least 2 distinct options",
        });
      }
      if (!input.question.trim()) {
        throw new ORPCError("BAD_REQUEST", { message: "Question required" });
      }
      const [row] = await db
        .insert(pot)
        .values({
          appId,
          creatorUserId,
          question: input.question.trim(),
          options,
          deadline: input.deadline ?? null,
        })
        .returning();
      return row!;
    },

    async stake(
      appId: AppId,
      actor: PotActor,
      input: { potId: PotId; option: string; txHash: Hex }
    ) {
      const row = await loadPot(appId, input.potId);
      if (row.status !== "open") {
        throw new ORPCError("CONFLICT", { message: "Pot is closed" });
      }
      if (!row.options.includes(input.option)) {
        throw new ORPCError("BAD_REQUEST", { message: "Unknown option" });
      }

      // DEMO: the stake was paid over a mocked relay (no real Transfer log) — skip
      // the on-chain verification and record a fixed 1-USDC stake.
      let value: Usdc;
      if (DEMO_MODE) {
        value = MIN_STAKE;
      } else {
        if (!actor.walletAddress) {
          throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
        }
        // Verify the stake landed in escrow (the agent server wallet). Keyed on
        // the Transfer LOG, so a relayed EIP-3009 stake is accepted (§12).
        const verified = await onchain.verifyUsdcTransfer({
          hash: input.txHash,
          chain: PUBLIC_CHAIN,
          expectedTo: onchain.serverAddress,
          minAmount: MIN_STAKE,
        });
        if (!isAddressEqual(verified.from, actor.walletAddress as `0x${string}`)) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Stake must come from your wallet",
          });
        }
        value = verified.value;
      }
      if (value > POT_STAKE_MAX) {
        throw new ORPCError("BAD_REQUEST", { message: "Stake over the cap" });
      }
      const existing = sumUsdc(
        (await stakesOf(input.potId)).map((s) => parseUsdc(s.amountUsdc))
      );
      if (existing + value > POT_TOTAL_MAX) {
        throw new ORPCError("BAD_REQUEST", { message: "Pot is full" });
      }

      try {
        const [created] = await db
          .insert(potStake)
          .values({
            potId: input.potId,
            userId: actor.id,
            option: input.option,
            amountUsdc: formatUsdc(value),
            txHash: input.txHash,
          })
          .returning();
        return created!;
      } catch (err) {
        // txHash UNIQUE = replay guard (§7).
        if (isUniqueViolation(err)) {
          throw new ORPCError("CONFLICT", { message: "Stake already recorded" });
        }
        throw err;
      }
    },

    async get(appId: AppId, potId: PotId, viewerId: UserId) {
      const row = await loadPot(appId, potId);
      const stakes = await stakesOf(potId);
      const byOption = new Map<string, { amount: Usdc; count: number }>();
      for (const o of row.options) byOption.set(o, { amount: usdc(0n), count: 0 });
      for (const s of stakes) {
        const slot = byOption.get(s.option);
        if (slot) {
          slot.amount = (slot.amount + parseUsdc(s.amountUsdc)) as Usdc;
          slot.count += 1;
        }
      }
      const mine = stakes.find((s) => s.userId === viewerId) ?? null;
      return {
        id: row.id,
        question: row.question,
        options: row.options,
        status: row.status,
        resolvedOption: row.resolvedOption,
        deadline: row.deadline,
        creatorUserId: row.creatorUserId,
        totalPool: formatUsdc(
          sumUsdc(stakes.map((s) => parseUsdc(s.amountUsdc)))
        ),
        totals: row.options.map((o) => ({
          option: o,
          amountUsdc: formatUsdc(byOption.get(o)!.amount),
          count: byOption.get(o)!.count,
        })),
        myStake: mine
          ? { option: mine.option, amountUsdc: mine.amountUsdc }
          : null,
      };
    },

    async resolve(
      appId: AppId,
      actorId: UserId,
      input: { potId: PotId; resolvedOption?: string }
    ) {
      const row = await loadPot(appId, input.potId);
      if (row.creatorUserId !== actorId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Only the pot creator can resolve it",
        });
      }
      if (row.status !== "open") {
        throw new ORPCError("CONFLICT", { message: "Pot already resolved" });
      }

      let outcome = input.resolvedOption;
      if (!outcome) {
        const verdict = await oracle.resolve({
          question: row.question,
          options: row.options,
        });
        outcome = verdict.option;
      }
      if (!row.options.includes(outcome)) {
        throw new ORPCError("BAD_REQUEST", { message: "Outcome not an option" });
      }

      await db
        .update(pot)
        .set({ status: "resolved", resolvedOption: outcome })
        .where(eq(pot.id, input.potId));

      const paid = await this.payout(input.potId);
      return { resolvedOption: outcome, ...paid };
    },

    /** Idempotent pro-rata payout. Safe to re-run after a partial failure —
     *  stakes with a `paidOutTxHash` are skipped. Returns a per-stake ledger. */
    async payout(potId: PotId) {
      const row = await db.query.pot.findFirst({ where: eq(pot.id, potId) });
      if (!row || row.status !== "resolved" || !row.resolvedOption) {
        throw new ORPCError("CONFLICT", { message: "Pot not resolved" });
      }
      const stakes = await stakesOf(potId);
      const totalPool = sumUsdc(stakes.map((s) => parseUsdc(s.amountUsdc)));
      const winners = stakes.filter((s) => s.option === row.resolvedOption);
      // No winner ⇒ refund everyone (proRata over the full pool = own stake).
      const targets = winners.length > 0 ? winners : stakes;
      const winningTotal = sumUsdc(targets.map((s) => parseUsdc(s.amountUsdc)));

      // Resolve staker addresses in one query (then sequence the sends —
      // pglite hangs on concurrent statements on one connection).
      const userIds = [...new Set(targets.map((s) => s.userId))];
      const wallets = new Map<string, string | null>();
      if (userIds.length > 0) {
        const rows = await db
          .select({ id: user.id, walletAddress: user.walletAddress })
          .from(user)
          .where(inArray(user.id, userIds));
        for (const u of rows) wallets.set(u.id, u.walletAddress);
      }

      const ledger: { stakeId: string; payoutUsdc: string; txHash: Hex }[] = [];
      for (const s of targets) {
        if (s.paidOutTxHash) continue; // idempotency gate
        const payout =
          winningTotal > 0n
            ? proRata(totalPool, parseUsdc(s.amountUsdc), winningTotal)
            : usdc(0n);
        if (payout <= 0n) continue;
        const to = wallets.get(s.userId);
        if (!to) continue; // can't pay a walletless staker; leaves dust in escrow
        // DEMO: don't depend on a funded escrow wallet — record a fake payout hash.
        const txHash = DEMO_MODE
          ? (fakeTxHash() as Hex)
          : await onchain.sendUsdc(PUBLIC_CHAIN, to as `0x${string}`, payout);
        await db
          .update(potStake)
          .set({ paidOutTxHash: txHash })
          .where(eq(potStake.id, s.id));
        ledger.push({ stakeId: s.id, payoutUsdc: formatUsdc(payout), txHash });
      }
      return { chainId: USDC[PUBLIC_CHAIN].chainId, payouts: ledger };
    },
  };
};

export type PotService = ReturnType<typeof createPotService>;
