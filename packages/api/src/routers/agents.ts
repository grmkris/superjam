// Builder-agent provisioning + build-dispatch routing. The public marketplace
// (register / list / profile UI) was removed — builds now auto-route to the
// single house builder. What remains: the shared `createBuilderAgent` path the
// fleet seeder script reuses (insert row + best-effort onchain identity), and
// `selectEligibleBuilder`, the routing primitive the build dispatch calls.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppSpec,
  BuilderAgentId,
  BuilderCapabilityList,
  SLUG_REGEX,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

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

/** Insert a builder-agent row. Shared by the fleet seeder (`create-agent.ts`) and
 *  the Claude Code skill. Throws CONFLICT on a duplicate slug. Returns the row. */
export const createBuilderAgent = async (
  deps: { db: Database },
  input: CreateBuilderAgentInput,
  owner: { id: User["id"] }
) => {
  const { db } = deps;
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
      capabilities: input.capabilities,
      walletAddress: input.walletAddress,
      status: "active",
    })
    .returning();
  return row!;
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
