// Builder-agent provisioning + build-dispatch routing. The public marketplace
// (register / list / profile UI) was removed — builds now auto-route to the
// single house builder. What remains: the shared `createBuilderAgent` path the
// fleet seeder script reuses (insert row + best-effort onchain identity), and
// `selectEligibleBuilder`, the routing primitive the build dispatch calls.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import type { Logger } from "@superjam/logger";
import {
  type AppSpec,
  BuilderAgentId,
  BuilderCapabilityList,
  SLUG_REGEX,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AgentIdentity } from "../lib/agent-identity.ts";

const { builderAgent } = schema;
type User = typeof schema.user.$inferSelect;
type BuilderAgent = typeof schema.builderAgent.$inferSelect;

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
