import { describe, expect, test } from "bun:test";
import type { AppSpec } from "@superjam/shared";
import { createAgentGenerator, selectRecipes } from "./agent-generate.ts";

const baseSpec: AppSpec = {
  name: "Quiz Night",
  slug: "quiz-night",
  description: "a fast trivia quiz with a leaderboard",
  iconEmoji: "🧠",
  category: "game",
  capabilities: ["ai"],
  features: ["trivia questions", "verified-human leaderboard"],
  data: {
    collections: [],
    counters: [{ name: "scores", keyedBy: "username", meaning: "all-time points" }],
    storage: [],
  },
  ai: { uses: ["generate questions"] },
  ui: { layout: "card", sections: ["question", "board"] },
  skills: [],
  acceptance: ["shows a question with options", "a correct answer increments scores"],
};

const ctx = { buildId: "b1", appId: "app_1" };
const SDK_PAGE = '"use client";\nimport SuperJam from "@superjam/sdk";\nexport default function Page() { return null; }';

describe("selectRecipes", () => {
  test("always includes _base + INDEX and picks quiz by keyword", () => {
    const r = selectRecipes(baseSpec);
    expect(r).toContain("_base");
    expect(r).toContain("INDEX");
    expect(r).toContain("quiz");
  });

  test("maps the market skill to the market recipe", () => {
    const r = selectRecipes({ ...baseSpec, name: "x", description: "y", features: [], skills: ["market"] });
    expect(r).toContain("market");
  });

  test("data keyword routes to the own-backend recipe", () => {
    const r = selectRecipes({ ...baseSpec, name: "Spending", description: "explain a CSV spreadsheet", features: [] });
    expect(r).toContain("data");
  });
});

describe("createAgentGenerator", () => {
  test("merges agent output over the skeleton when the page is implemented", async () => {
    const gen = createAgentGenerator({
      loadRecipes: async () => "",
      runAgent: async ({ files }) => ({ ...files, "app/page.tsx": SDK_PAGE }),
    });
    const app = await gen(baseSpec, ctx);
    expect(app.files["app/page.tsx"]).toBe(SDK_PAGE);
    expect(app.manifest.slug).toBe("quiz-night");
    // fixed boilerplate from the skeleton survives the merge
    expect(app.files["lib/auth.ts"]).toBeDefined();
  });

  test("falls back to the skeleton when the agent throws", async () => {
    const gen = createAgentGenerator({
      loadRecipes: async () => "",
      runAgent: async () => {
        throw new Error("boom");
      },
    });
    const app = await gen(baseSpec, ctx);
    expect(app.files["app/page.tsx"]).toContain("export default function Page");
    expect(app.files["app/page.tsx"]).not.toContain("@superjam/sdk");
  });

  test("falls back when the agent leaves the page unimplemented", async () => {
    const gen = createAgentGenerator({
      loadRecipes: async () => "",
      runAgent: async ({ files }) => files, // returned the skeleton unchanged
    });
    const app = await gen(baseSpec, ctx);
    expect(app.files["app/page.tsx"]).not.toContain("@superjam/sdk");
  });

  test("passes the rendered spec + recipes into the agent prompt", async () => {
    let seen: { system: string; prompt: string } | null = null;
    const gen = createAgentGenerator({
      loadRecipes: async () => "RECIPE_MARKER",
      runAgent: async (args) => {
        seen = { system: args.system, prompt: args.prompt };
        return { ...args.files, "app/page.tsx": SDK_PAGE };
      },
    });
    await gen(baseSpec, ctx);
    expect(seen!.system).toContain("RECIPE_MARKER");
    expect(seen!.prompt).toContain("Quiz Night");
    expect(seen!.prompt).toContain("a correct answer increments scores"); // acceptance item
  });
});
