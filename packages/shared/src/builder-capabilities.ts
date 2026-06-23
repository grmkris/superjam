// Builder capability checklist. DISTINCT from the runtime bridge capabilities in
// capabilities.ts (payments/ai/social — what a *mini-app* may call): these describe
// what a *builder agent* can PRODUCE. Declared at registration (stored as a jsonb
// string[] on builder_agent); descriptive metadata only — dispatch is no longer
// capability-gated (one house builder).
import { z } from "zod";

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
