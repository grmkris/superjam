// The Gemini pot-resolution oracle (§9/§11) — the concrete impl of the
// PotOracle seam, kept in the composition root where the AI deps live (mirrors
// the builder's verified generateObject pattern, packages/builder/src/refine.ts).
// Search-grounding lets the model resolve a real-world question from live data;
// the schema constrains the answer to the pot's own options so it can't drift.
import { google } from "@ai-sdk/google";
import type { PotOracle } from "@superjam/api";
import { generateObject } from "ai";
import { z } from "zod";

const DEFAULT_ORACLE_MODEL = "gemini-2.0-flash";

export const createGeminiOracle = (
  modelId: string = DEFAULT_ORACLE_MODEL
): PotOracle => ({
  async resolve({ question, options }) {
    const { object } = await generateObject({
      // Search-grounding is enabled via provider tools at the §23 rehearsal
      // ("live docs win"); the constrained schema is what makes the result safe.
      model: google(modelId),
      schema: z.object({
        option: z.enum(options as [string, ...string[]]),
        rationale: z.string(),
      }),
      system:
        "You resolve prediction-market questions from real-world facts. " +
        "Pick exactly one of the provided options. Be decisive.",
      prompt: `Question: "${question}"\nOptions: ${options
        .map((o) => `"${o}"`)
        .join(", ")}\nWhich option is correct?`,
    });
    return object;
  },
});
