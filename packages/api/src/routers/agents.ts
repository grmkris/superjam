// Agents router (§14, M8) — the open builder marketplace. Anyone World-verified
// can register THEIR build agent (the AgentKit primitive: every marketplace
// agent is bound to a verified human). An agent declares a capability checklist;
// the platform routes a build only to agents that hold the required caps
// (findEligibleBuilders, consumed by S's dispatch). On register the agent gets
// an ENS subname under its owner + an ERC-8004 record via C's onchain seam
// (best-effort). The builder's auth `token` is write-only — never returned.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type BuilderCapability,
  BuilderAgentId,
  BuilderCapabilityList,
  eligibleAgents,
  SLUG_REGEX,
} from "@superjam/shared";
import { ORPCError, os } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ApiContext } from "../context.ts";
import { type AgentIdentity, nullAgentIdentity } from "../lib/agent-identity.ts";
import { protectedProcedure, publicProcedure, worldVerifiedProcedure } from "../orpc.ts";

const { builderAgent } = schema;
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
  ensName: a.ensName,
  buildsCount: a.buildsCount,
  status: a.status,
  createdAt: a.createdAt,
});

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USDC_AMOUNT = /^\d+(\.\d{1,6})?$/;

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
});

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
      const clash = await context.db.query.builderAgent.findFirst({
        where: eq(builderAgent.slug, input.slug),
      });
      if (clash) {
        throw new ORPCError("CONFLICT", {
          message: `A builder named "${input.slug}" already exists.`,
        });
      }

      const [row] = await context.db
        .insert(builderAgent)
        .values({
          ownerUserId: context.user.id,
          name: input.name,
          slug: input.slug,
          endpointUrl: input.endpointUrl,
          token: input.token,
          priceUsdc: input.priceUsdc,
          capabilities: input.capabilities,
          walletAddress: input.walletAddress,
          status: "active",
        })
        .returning();
      const agent = row!;

      // Best-effort onchain identity (ENS subname + ERC-8004). A failure here
      // never fails registration — the agent is just un-named until a retry.
      let ensName = agent.ensName;
      try {
        const identity = await context.agentIdentity.provision({
          agentId: agent.id,
          slug: agent.slug,
          ownerUsername: context.user.username,
          ownerWallet: context.user.walletAddress ?? undefined,
          walletAddress: agent.walletAddress,
        });
        if (identity.ensName) {
          ensName = identity.ensName;
          await context.db
            .update(builderAgent)
            .set({ ensName })
            .where(eq(builderAgent.id, agent.id));
        }
      } catch (err) {
        context.logger.warn(
          { err: String(err), agentId: agent.id },
          "agent identity provision failed"
        );
      }

      return toAgent({ ...agent, ensName });
    }),

  // Public marketplace listing — active agents, busiest first.
  list: publicProcedure.handler(async ({ context }) => {
    const rows = await context.db.query.builderAgent.findMany({
      where: eq(builderAgent.status, "active"),
      orderBy: [desc(builderAgent.buildsCount), desc(builderAgent.createdAt)],
    });
    return rows.map(toAgent);
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
