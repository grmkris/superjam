// Agents router (§14, M8) — the open builder marketplace. Anyone World-verified
// can register THEIR build agent (the AgentKit primitive: every marketplace
// agent is bound to a verified human). An agent declares a capability checklist;
// the platform routes a build only to agents that hold the required caps
// (findEligibleBuilders, consumed by S's dispatch). On register the agent gets
// an ENS subname under its owner + an ERC-8004 record via C's onchain seam
// (best-effort). The builder's auth `token` is write-only — never returned.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import type { Logger } from "@superjam/logger";
import {
  type AppSpec,
  type BuilderCapability,
  BuilderAgentId,
  BuilderCapabilityList,
  eligibleAgents,
  SLUG_REGEX,
  TX_CAP_USDC,
} from "@superjam/shared";
import { formatUsdc, parseUsdc } from "@superjam/onchain";
import { ORPCError, os } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import type { Address } from "viem";
import { z } from "zod";
import type { ApiContext } from "../context.ts";
import { type AgentIdentity, nullAgentIdentity } from "../lib/agent-identity.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { protectedProcedure, publicProcedure, worldVerifiedProcedure } from "../orpc.ts";

const { builderAgent, user: userTable } = schema;
type User = typeof schema.user.$inferSelect;
type BuilderAgent = typeof schema.builderAgent.$inferSelect;

// Public projection — everything but the secret `token`.
export const toAgent = (a: BuilderAgent) => ({
  id: a.id,
  ownerUserId: a.ownerUserId,
  name: a.name,
  slug: a.slug,
  endpointUrl: a.endpointUrl,
  priceUsdc: a.priceUsdc,
  capabilities: a.capabilities,
  walletAddress: a.walletAddress,
  model: a.model,
  ensName: a.ensName,
  erc8004Id: a.erc8004Id,
  stakedUsdc: a.stakedUsdc,
  stakeTxHash: a.stakeTxHash,
  agentbookRegistered: a.agentbookRegistered,
  buildsCount: a.buildsCount,
  status: a.status,
  createdAt: a.createdAt,
});

// Marketplace-card / profile projection: the agent + its human-backer
// (@username + ✓-human) so the /agents cards + builder profile (§3c-v) can show
// "backed by a real human ✓ · by @owner" without a second round-trip.
export const toAgentCard = (
  a: BuilderAgent,
  owner: { username: string; worldVerified: boolean }
) => ({
  ...toAgent(a),
  owner: { username: owner.username, worldVerified: owner.worldVerified },
});

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USDC_AMOUNT = /^\d+(\.\d{1,6})?$/;
const TX_CAP = parseUsdc(TX_CAP_USDC);

const RegisterInput = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(SLUG_REGEX),
  endpointUrl: z.string().url(),
  token: z.string().min(1),
  priceUsdc: z.string().regex(USDC_AMOUNT).default("0"),
  capabilities: BuilderCapabilityList,
  walletAddress: z
    .string()
    .regex(EVM_ADDRESS)
    .transform((s) => s.toLowerCase()),
  /** The agent's coding model (Opus/Sonnet …). Optional — house default if unset. */
  model: z.string().min(1).optional(),
});

export type CreateBuilderAgentInput = z.infer<typeof RegisterInput>;

/** The SINGLE builder-agent registration path — shared by the worldVerified
 *  `register` endpoint (community, via the website), the platform `create-agent`
 *  script (the fleet), and the Claude Code skill. Inserts the row + provisions the
 *  agent's onchain identity (ENS + ERC-8004 + StakeSlash stake + AgentBook detect),
 *  all best-effort (a provision failure never fails registration). Throws CONFLICT
 *  on a duplicate slug. Returns the full agent row with the provisioned fields. */
export const createBuilderAgent = async (
  deps: { db: Database; agentIdentity: AgentIdentity; logger: Logger },
  input: CreateBuilderAgentInput,
  owner: { id: User["id"]; username: string; walletAddress: string | null }
) => {
  const { db, agentIdentity, logger } = deps;
  const clash = await db.query.builderAgent.findFirst({
    where: eq(builderAgent.slug, input.slug),
  });
  if (clash) {
    throw new ORPCError("CONFLICT", {
      message: `A builder named "${input.slug}" already exists.`,
    });
  }
  const [row] = await db
    .insert(builderAgent)
    .values({
      ownerUserId: owner.id,
      name: input.name,
      slug: input.slug,
      endpointUrl: input.endpointUrl,
      token: input.token,
      priceUsdc: input.priceUsdc,
      model: input.model ?? null,
      capabilities: input.capabilities,
      walletAddress: input.walletAddress,
      status: "active",
    })
    .returning();
  const agent = row!;

  // Best-effort onchain identity — ENS subname + ERC-8004 + StakeSlash stake +
  // AgentBook detect. A failure here never fails registration.
  let ensName = agent.ensName;
  let erc8004Id = agent.erc8004Id;
  let stakedUsdc = agent.stakedUsdc;
  let stakeTxHash = agent.stakeTxHash;
  let agentbookRegistered = agent.agentbookRegistered;
  let agentbookHumanId = agent.agentbookHumanId;
  try {
    const identity = await agentIdentity.provision({
      agentId: agent.id,
      slug: agent.slug,
      ownerUsername: owner.username,
      ownerWallet: owner.walletAddress ?? undefined,
      walletAddress: agent.walletAddress,
    });
    const patch: Partial<typeof builderAgent.$inferInsert> = {};
    if (identity.ensName) {
      ensName = identity.ensName;
      patch.ensName = ensName;
    }
    if (identity.erc8004Id) {
      erc8004Id = identity.erc8004Id;
      patch.erc8004Id = erc8004Id;
    }
    if (identity.stakeTxHash) {
      stakeTxHash = identity.stakeTxHash;
      stakedUsdc = identity.stakedUsdc ?? null;
      patch.stakeTxHash = stakeTxHash;
      patch.stakedUsdc = stakedUsdc;
    }
    if (identity.agentbookRegistered) {
      agentbookRegistered = true;
      agentbookHumanId = identity.agentbookHumanId ?? null;
      patch.agentbookRegistered = true;
      patch.agentbookHumanId = agentbookHumanId;
    }
    if (Object.keys(patch).length > 0) {
      await db
        .update(builderAgent)
        .set(patch)
        .where(eq(builderAgent.id, agent.id));
    }
  } catch (err) {
    logger.warn(
      { err: String(err), agentId: agent.id },
      "agent identity provision failed"
    );
  }
  return {
    ...agent,
    ensName,
    erc8004Id,
    stakedUsdc,
    stakeTxHash,
    agentbookRegistered,
    agentbookHumanId,
  };
};

/** Re-provision an EXISTING agent's onchain identity, filling only the gaps —
 *  mint the ERC-8004 id / ENS name / seed stake if (and only if) it's still
 *  missing. Idempotent (provision is `current`-aware, so nothing double-mints) and
 *  best-effort (a provision failure leaves the row untouched). Shared by the
 *  `refreshIdentity` mutation and the fleet backfill script. Returns the patched row. */
export const refreshAgentIdentity = async (
  deps: { db: Database; agentIdentity: AgentIdentity; logger: Logger },
  agent: BuilderAgent,
  owner: { username: string; walletAddress: string | null }
): Promise<BuilderAgent> => {
  const { db, agentIdentity, logger } = deps;
  try {
    const identity = await agentIdentity.provision({
      agentId: agent.id,
      slug: agent.slug,
      ownerUsername: owner.username,
      ownerWallet: owner.walletAddress ?? undefined,
      walletAddress: agent.walletAddress,
      current: {
        ensName: agent.ensName,
        erc8004Id: agent.erc8004Id,
        stakedUsdc: agent.stakedUsdc,
      },
    });
    const patch: Partial<typeof builderAgent.$inferInsert> = {};
    if (identity.ensName && identity.ensName !== agent.ensName) {
      patch.ensName = identity.ensName;
    }
    if (identity.erc8004Id && identity.erc8004Id !== agent.erc8004Id) {
      patch.erc8004Id = identity.erc8004Id;
    }
    if (identity.stakeTxHash && !agent.stakedUsdc) {
      patch.stakeTxHash = identity.stakeTxHash;
      patch.stakedUsdc = identity.stakedUsdc ?? null;
    }
    // AgentBook is a fresh read every refresh — persist it authoritatively (flips
    // the badge true once the wallet is registered) when it actually changed.
    if (
      identity.agentbookRegistered !== undefined &&
      (identity.agentbookRegistered !== agent.agentbookRegistered ||
        (identity.agentbookHumanId ?? null) !== agent.agentbookHumanId)
    ) {
      patch.agentbookRegistered = identity.agentbookRegistered;
      patch.agentbookHumanId = identity.agentbookHumanId ?? null;
    }
    if (Object.keys(patch).length === 0) return agent;
    const [updated] = await db
      .update(builderAgent)
      .set(patch)
      .where(eq(builderAgent.id, agent.id))
      .returning();
    return updated!;
  } catch (err) {
    logger.warn(
      { err: String(err), agentId: agent.id },
      "agent identity refresh failed"
    );
    return agent;
  }
};

// register mints the agent's onchain identity through C's seam. Rather than
// widen the shared ApiContext, the dependency is declared locally (mirrors the
// world router) and defaulted to the no-op so register works seam-less in tests.
const withIdentity = os
  .$context<ApiContext & { user: User; agentIdentity?: AgentIdentity }>()
  .middleware(({ context, next }) =>
    next({
      context: { agentIdentity: context.agentIdentity ?? nullAgentIdentity },
    })
  );

export const agentsRouter = {
  // Human-backed registration (worldVerified-gated — the AgentKit story).
  register: worldVerifiedProcedure
    .use(withIdentity)
    .input(RegisterInput)
    .handler(async ({ context, input }) => {
      const agent = await createBuilderAgent(
        {
          db: context.db,
          agentIdentity: context.agentIdentity,
          logger: context.logger,
        },
        input,
        {
          id: context.user.id,
          username: context.user.username,
          walletAddress: context.user.walletAddress,
        }
      );
      return toAgent(agent);
    }),

  // Public marketplace listing — active agents, busiest first, with backer.
  list: publicProcedure.handler(async ({ context }) => {
    const rows = await context.db
      .select({
        agent: builderAgent,
        username: userTable.username,
        worldVerified: userTable.worldVerified,
      })
      .from(builderAgent)
      .innerJoin(userTable, eq(builderAgent.ownerUserId, userTable.id))
      .where(eq(builderAgent.status, "active"))
      .orderBy(desc(builderAgent.buildsCount), desc(builderAgent.createdAt));
    return rows.map((r) =>
      toAgentCard(r.agent, {
        username: r.username,
        worldVerified: r.worldVerified,
      })
    );
  }),

  // Public builder profile (§3c-v) — one agent + its backer, any status.
  get: publicProcedure
    .input(z.object({ agentId: BuilderAgentId }))
    .handler(async ({ context, input }) => {
      const [r] = await context.db
        .select({
          agent: builderAgent,
          username: userTable.username,
          worldVerified: userTable.worldVerified,
        })
        .from(builderAgent)
        .innerJoin(userTable, eq(builderAgent.ownerUserId, userTable.id))
        .where(eq(builderAgent.id, input.agentId));
      if (!r) {
        throw new ORPCError("NOT_FOUND", { message: "Builder not found" });
      }
      return toAgentCard(r.agent, {
        username: r.username,
        worldVerified: r.worldVerified,
      });
    }),

  // Live on-chain stake + pool yield for a builder — the trust signal made real
  // (the `🌱 staked` badge reads a snapshot; this reads the chain). `poolYieldUsdc`
  // is the escrow-wide accrued yield (the vault is shared; yield isn't per-builder).
  // Falls back to the DB snapshot when the escrow isn't configured or a read fails.
  stakeInfo: publicProcedure
    .input(z.object({ agentId: BuilderAgentId }))
    .handler(async ({ context, input }) => {
      const row = await context.db.query.builderAgent.findFirst({
        where: eq(builderAgent.id, input.agentId),
      });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Builder not found" });
      }
      const stakeSlash = context.onchain.stakeSlash;
      if (stakeSlash && EVM_ADDRESS.test(row.walletAddress)) {
        try {
          const [staked, poolYield] = await Promise.all([
            stakeSlash.stakeOf(row.walletAddress as Address),
            stakeSlash.accruedYield(),
          ]);
          return {
            stakedUsdc: formatUsdc(staked),
            poolYieldUsdc: formatUsdc(poolYield),
            live: true,
          };
        } catch (err) {
          context.logger.debug(
            { err: String(err), agentId: row.id },
            "stakeInfo live read failed"
          );
        }
      }
      return { stakedUsdc: row.stakedUsdc, poolYieldUsdc: null, live: false };
    }),

  // Owner re-provisions their agent's onchain identity — backfills a missing
  // ERC-8004 id / ENS name / seed stake without re-registering. Idempotent.
  refreshIdentity: protectedProcedure
    .use(withIdentity)
    .input(z.object({ agentId: BuilderAgentId }))
    .handler(async ({ context, input }) => {
      const [r] = await context.db
        .select({
          agent: builderAgent,
          username: userTable.username,
          worldVerified: userTable.worldVerified,
          walletAddress: userTable.walletAddress,
        })
        .from(builderAgent)
        .innerJoin(userTable, eq(builderAgent.ownerUserId, userTable.id))
        .where(eq(builderAgent.id, input.agentId));
      if (!r) {
        throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
      }
      if (r.agent.ownerUserId !== context.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not your agent" });
      }
      const updated = await refreshAgentIdentity(
        {
          db: context.db,
          agentIdentity: context.agentIdentity,
          logger: context.logger,
        },
        r.agent,
        { username: r.username, walletAddress: r.walletAddress }
      );
      return toAgentCard(updated, {
        username: r.username,
        worldVerified: r.worldVerified,
      });
    }),

  // Owner tops up their builder's stake. Sponsored on testnet: the server wallet
  // executes `depositFor(builderWallet, amount)` (same rail as the seed stake), so
  // no user funds move. Bumps the on-chain stake + the persisted snapshot.
  topUpStake: protectedProcedure
    .input(
      z.object({
        agentId: BuilderAgentId,
        amount: z.string().regex(USDC_AMOUNT),
      })
    )
    .handler(async ({ context, input }) => {
      const row = await context.db.query.builderAgent.findFirst({
        where: eq(builderAgent.id, input.agentId),
      });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
      }
      if (row.ownerUserId !== context.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not your agent" });
      }
      const stakeSlash = context.onchain.stakeSlash;
      if (!stakeSlash) {
        throw new ORPCError("INTERNAL", { message: "Staking unavailable" });
      }
      const amount = parseUsdc(input.amount);
      if (amount > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      const wallet = row.walletAddress as Address;
      const txHash = await tryOnchain(() => stakeSlash.depositFor(wallet, amount));
      // Re-read the live stake for the persisted snapshot (best-effort).
      const stakedUsdc = await stakeSlash
        .stakeOf(wallet)
        .then(formatUsdc)
        .catch(() => row.stakedUsdc);
      await context.db
        .update(builderAgent)
        .set({ stakedUsdc, stakeTxHash: txHash })
        .where(eq(builderAgent.id, row.id));
      return { txHash, stakedUsdc };
    }),

  // Owner tops up their builder's stake from ANOTHER chain via CCTP (Circle #2):
  // burns USDC on Sepolia with hookData=builder → the Arc CctpEscrowHook mints +
  // credits the stake atomically (~1 min, Fast Transfer). Server-orchestrated on
  // testnet (the platform's Sepolia USDC is the source).
  topUpStakeCrossChain: protectedProcedure
    .input(
      z.object({
        agentId: BuilderAgentId,
        amount: z.string().regex(USDC_AMOUNT),
      })
    )
    .handler(async ({ context, input }) => {
      const row = await context.db.query.builderAgent.findFirst({
        where: eq(builderAgent.id, input.agentId),
      });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
      }
      if (row.ownerUserId !== context.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not your agent" });
      }
      const amount = parseUsdc(input.amount);
      if (amount > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      const wallet = row.walletAddress as Address;
      try {
        const { burnTxHash, mintTxHash } = await tryOnchain(() =>
          context.onchain.stakeViaCctp({ builder: wallet, amount })
        );
        // Re-read the live stake for the persisted snapshot (best-effort).
        const stakeSlash = context.onchain.stakeSlash;
        const stakedUsdc = stakeSlash
          ? await stakeSlash
              .stakeOf(wallet)
              .then(formatUsdc)
              .catch(() => row.stakedUsdc)
          : row.stakedUsdc;
        await context.db
          .update(builderAgent)
          .set({ stakedUsdc, stakeTxHash: mintTxHash })
          .where(eq(builderAgent.id, row.id));
        return { burnTxHash, mintTxHash, stakedUsdc };
      } catch (err) {
        // Surface the real cause (CCTP/hook fault) — the client only sees a generic
        // failure otherwise (mirrors the addFunds logging).
        const e = err as { code?: string; message?: string };
        context.logger.error(
          {
            path: "agents.topUpStakeCrossChain",
            agentId: row.id,
            code: e?.code,
            message: e?.message,
          },
          "stakeViaCctp failed"
        );
        throw err;
      }
    }),

  // The caller's own agents (any status).
  mine: protectedProcedure.handler(async ({ context }) => {
    const rows = await context.db.query.builderAgent.findMany({
      where: eq(builderAgent.ownerUserId, context.user.id),
      orderBy: [desc(builderAgent.createdAt)],
    });
    return rows.map(toAgent);
  }),

  // Owner disables their own agent (removes it from the marketplace + routing).
  disable: protectedProcedure
    .input(z.object({ agentId: BuilderAgentId }))
    .handler(async ({ context, input }) => {
      const row = await context.db.query.builderAgent.findFirst({
        where: eq(builderAgent.id, input.agentId),
      });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
      }
      if (row.ownerUserId !== context.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not your agent" });
      }
      await context.db
        .update(builderAgent)
        .set({ status: "disabled" })
        .where(eq(builderAgent.id, row.id));
      return toAgent({ ...row, status: "disabled" });
    }),
};

/**
 * Active builders that can deliver `required` — the routing primitive S's build
 * dispatch calls to pick (or reject) a builder for a spec. Pure DB read; the
 * capability match is the shared `eligibleAgents` logic.
 */
export const findEligibleBuilders = async (
  db: Database,
  required: readonly BuilderCapability[]
): Promise<BuilderAgent[]> => {
  const rows = await db.query.builderAgent.findMany({
    where: eq(builderAgent.status, "active"),
  });
  return eligibleAgents(rows, required);
};

/** The builder S's dispatch should send a build to, + the dispatch creds. */
export interface SelectedBuilder {
  agent: BuilderAgent;
  endpointUrl: string;
  /** The builder's secret dispatch token (server-side only — never to a client). */
  token: string;
}

// Cheapest first (it's the user's money), then most-built (proven), then oldest.
const byPreference = (a: BuilderAgent, b: BuilderAgent): number =>
  Number(a.priceUsdc) - Number(b.priceUsdc) ||
  b.buildsCount - a.buildsCount ||
  a.createdAt.getTime() - b.createdAt.getTime();

/**
 * Pick the builder for a spec (the routing primitive S's `runBuild` calls):
 * honor the requested `agentId` if it's active, else the preferred default.
 * Dispatch is NOT gated on a capability checklist — all builders share the same
 * under-the-hood toolchain (data/payments/hosting ride the platform bridge + SDK);
 * they differ only by coding model, so any active builder can take any spec.
 * Returns null only when the pick is unknown/disabled or the registry is empty —
 * the caller (builds.create) REJECTS the build; there is no house fallback.
 * Pure DB read; no dispatch, no side effects.
 */
export const selectEligibleBuilder = async (
  db: Database,
  _spec: AppSpec, // kept for signature stability; no longer used for gating
  opts: { agentId?: BuilderAgentId } = {}
): Promise<SelectedBuilder | null> => {
  const active = await db.query.builderAgent.findMany({
    where: eq(builderAgent.status, "active"),
  });
  if (active.length === 0) {
    return null;
  }
  if (opts.agentId) {
    const picked = active.find((a) => a.id === opts.agentId);
    // Honor the user's pick if it's a real, active builder; a missing/disabled
    // pick is a hard miss, not a silent reroute to someone else.
    return picked ? toSelected(picked) : null;
  }
  return toSelected(active.toSorted(byPreference)[0]!);
};

const toSelected = (agent: BuilderAgent): SelectedBuilder => ({
  agent,
  endpointUrl: agent.endpointUrl,
  token: agent.token,
});
