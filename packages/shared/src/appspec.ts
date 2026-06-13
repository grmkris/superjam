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
        doc: z.record(z.string(), DocField),
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

// refine result — either follow-up questions or a finished spec.
export const RefineQuestionsSchema = z.object({
  type: z.literal("questions"),
  questions: z
    .array(z.object({ q: z.string(), options: z.array(z.string()) }))
    .min(2)
    .max(4),
  similar: SimilarList,
});

export const RefineSpecSchema = z.object({
  type: z.literal("spec"),
  spec: AppSpecSchema,
  similar: SimilarList,
});

export const RefineResultSchema = z.discriminatedUnion("type", [
  RefineQuestionsSchema,
  RefineSpecSchema,
]);
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
