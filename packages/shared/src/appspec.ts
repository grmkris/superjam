// AppSpec — the refined spec the builder agent receives, and the refine-stage
// result union (§11). Shared so refine (server), the builder, and the wizard
// (web) all speak one shape.
import { z } from "zod";
import { CATEGORIES, SIMILAR_MAX, SLUG_REGEX } from "./constants.ts";
import { CAPABILITIES } from "./capabilities.ts";

// Skill registry (§10). The refiner selects ≤3; the zod enum makes a
// hallucinated skill impossible.
export const SKILLS = [
  "game-3d",
  "game-2d",
  "charts",
  "motion",
  "art",
  "judge",
  "market",
  // onchain games: the builder deploys a bespoke Solidity contract to Arc and
  // the jam plays against it via sdk.onchain (implies the "onchain" capability).
  "onchain",
] as const;
export const SkillName = z.enum(SKILLS);
export type SkillName = z.infer<typeof SkillName>;

const DocField = z.enum(["string", "number", "boolean"]);

export const AppSpecSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(SLUG_REGEX).describe("kebab-case, 3-32 chars"),
  description: z.string(),
  iconEmoji: z.string().min(1),
  category: z.enum(CATEGORIES),
  capabilities: z.array(z.enum(CAPABILITIES)),
  features: z.array(z.string()).describe("concrete feature bullets"),
  data: z.object({
    collections: z.array(
      z.object({
        name: z.string(),
        // Field list as plain pairs (NOT an open map): Gemini structured output
        // can't fill `additionalProperties`/`z.record` maps — it returns them
        // empty — so the shape that survives generateObject is an array.
        fields: z.array(z.object({ name: z.string(), type: DocField })),
        writtenWhen: z.string(),
      })
    ),
    counters: z.array(
      z.object({ name: z.string(), keyedBy: z.string(), meaning: z.string() })
    ),
    storage: z.array(z.object({ key: z.string(), meaning: z.string() })),
  }),
  payments: z
    .object({
      actions: z.array(
        z.object({
          label: z.string(),
          amountUsdc: z.string(),
          to: z.literal("appTreasury"),
        })
      ),
    })
    .optional(),
  ai: z.object({ uses: z.array(z.string()) }).optional(),
  social: z.object({ messagesSentWhen: z.array(z.string()) }).optional(),
  ui: z.object({ layout: z.string(), sections: z.array(z.string()) }),
  skills: z.array(SkillName).max(3).optional(),
  acceptance: z.array(z.string()).describe("self-check list for the build agent"),
});
export type AppSpec = z.infer<typeof AppSpecSchema>;

// Similar-jam hit surfaced during refine (§11). Server filters slugs that
// don't match a real listed app.
export const SimilarSchema = z.object({ slug: z.string(), reason: z.string() });
export type Similar = z.infer<typeof SimilarSchema>;

const SimilarList = z.array(SimilarSchema).max(SIMILAR_MAX).optional();

// refine result — either follow-up questions or a finished spec. A PLAIN object
// (not a discriminated union): the AI SDK renders a root `z.discriminatedUnion`
// as a top-level `anyOf`, which Gemini structured output can't honor — it ignores
// the schema and emits free-form JSON, so generateObject throws. `type` selects
// which payload is populated (`questions` xor `spec`); both are optional here and
// the consumer branches on `type`.
export const RefineResultSchema = z.object({
  type: z.enum(["questions", "spec"]),
  questions: z
    .array(z.object({ q: z.string(), options: z.array(z.string()) }))
    .min(2)
    .max(4)
    .optional(),
  spec: AppSpecSchema.optional(),
  similar: SimilarList,
});
export type RefineResult = z.infer<typeof RefineResultSchema>;

// Manifest the builder's submit() tool returns; the platform zod-validates it
// before any S3/ENS work (§11 step "after submit").
export const AppManifestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(SLUG_REGEX),
  description: z.string(),
  iconEmoji: z.string().min(1),
  category: z.enum(CATEGORIES),
  capabilities: z.array(z.enum(CAPABILITIES)),
});
export type AppManifest = z.infer<typeof AppManifestSchema>;

// --- Build-wizard draft (the resumable make-flow, persisted from prompt-start) ---

/** The make-flow's beats; mirrored into the URL (?step=) + the build_draft row. */
export const BUILD_STEPS = [
  "home",
  "followups",
  "plan",
  "builder",
  "worldgate",
  "workshop",
  "reveal",
] as const;
export type BuildStep = (typeof BUILD_STEPS)[number];
export const BuildStepSchema = z.enum(BUILD_STEPS);

/** The picked builder + how its build fee was settled (carried into builds.create). */
export const ChosenBuilderSchema = z.object({
  agentId: z.string(),
  payment: z
    .object({ via: z.literal("x402"), token: z.string() })
    .optional(),
});
export type ChosenBuilder = z.infer<typeof ChosenBuilderSchema>;

/** Everything the wizard needs to resume EXCEPT the queryable columns (step,
 *  prompt, spec, buildId) — stored as the `state` jsonb on build_draft. The web
 *  owns the shape; the server round-trips it (permissive). */
export const DraftStateSchema = z
  .object({
    questions: z
      .array(z.object({ q: z.string(), options: z.array(z.string()) }))
      .optional(),
    picks: z.record(z.string(), z.string()).optional(),
    comments: z.array(z.string()).optional(),
    exchange: z.array(z.object({ you: z.string(), back: z.string() })).optional(),
    similar: z.array(SimilarSchema).optional(),
    chosen: ChosenBuilderSchema.nullable().optional(),
    attachments: z
      .array(z.object({ key: z.string(), name: z.string(), mime: z.string() }))
      .optional(),
    revealSlug: z.string().nullable().optional(),
  })
  .passthrough();
export type DraftState = z.infer<typeof DraftStateSchema>;
