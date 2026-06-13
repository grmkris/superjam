// Builder capability checklist (§14 marketplace). DISTINCT from the runtime
// bridge capabilities in capabilities.ts (payments/ai/social — what a *mini-app*
// may call): these describe what a *builder agent* can PRODUCE. A builder
// declares the set it holds (stored as a jsonb string[] on builder_agent); an
// AppSpec implies the set a given build NEEDS; the platform routes a build only
// to agents that hold every required capability — so an art-only builder never
// gets a smart-contract job it can't deliver.
import { z } from "zod";
import type { AppSpec } from "./appspec.ts";

export const BUILDER_CAPABILITIES = [
  "frontend",
  "hosting:vercel",
  "hosting:railway",
  "hosting:self",
  "database:neon",
  "database:postgres",
  "database:mongo",
  "contracts:evm",
  "ai",
] as const;
export type BuilderCapability = (typeof BUILDER_CAPABILITIES)[number];

export const BuilderCapabilitySchema = z.enum(BUILDER_CAPABILITIES);
/** A declared capability set — deduped, at least one entry. */
export const BuilderCapabilityList = z
  .array(BuilderCapabilitySchema)
  .min(1)
  .transform((xs) => [...new Set(xs)]);

export const isBuilderCapability = (x: unknown): x is BuilderCapability =>
  typeof x === "string" &&
  (BUILDER_CAPABILITIES as readonly string[]).includes(x);

/**
 * The builder capabilities a given AppSpec requires. Every app needs a frontend
 * + somewhere to host it; data/payments/ai each pull in their backing tech. The
 * reference template hosts on Vercel + Neon, so those are the implied defaults
 * (a self-hosting or alt-DB builder simply declares a superset).
 */
export const requiredCapabilities = (spec: AppSpec): BuilderCapability[] => {
  const req = new Set<BuilderCapability>(["frontend", "hosting:vercel"]);
  const { collections, counters, storage } = spec.data;
  if (collections.length > 0 || counters.length > 0 || storage.length > 0) {
    req.add("database:neon");
  }
  if (spec.payments || spec.capabilities.includes("payments")) {
    req.add("contracts:evm");
  }
  if (spec.ai || spec.capabilities.includes("ai")) {
    req.add("ai");
  }
  return [...req];
};

/** An agent can take a build iff it holds every required capability. */
export const agentCanBuild = (
  agentCaps: readonly string[],
  required: readonly BuilderCapability[]
): boolean => required.every((c) => agentCaps.includes(c));

/** Filter a list of agents to those able to deliver `required`. */
export const eligibleAgents = <T extends { capabilities: readonly string[] }>(
  agents: readonly T[],
  required: readonly BuilderCapability[]
): T[] => agents.filter((a) => agentCanBuild(a.capabilities, required));
