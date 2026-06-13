import { describe, expect, test } from "bun:test";
import type { AppSpec, RefineResult } from "@superjam/shared";
import {
  buildPrompt,
  filterSimilar,
  refine,
  type RefineCatalogApp,
  type RefineGenerator,
} from "./refine.ts";

const SPEC: AppSpec = {
  name: "Tip Jar",
  slug: "tip-jar",
  description: "Send the creator a USDC tip.",
  iconEmoji: "💸",
  category: "tool",
  capabilities: ["payments"],
  features: ["Tip button", "Recent tippers wall"],
  data: { collections: [], counters: [], storage: [] },
  ui: { layout: "single column", sections: ["tip", "wall"] },
  acceptance: ["Tipping moves USDC"],
};

const specResult = (similar?: RefineResult["similar"]): RefineResult => ({
  type: "spec",
  spec: SPEC,
  similar,
});

const CATALOG: RefineCatalogApp[] = [
  { slug: "tip-jar", name: "Tip Jar", description: "tips", category: "tool" },
  { slug: "poll", name: "Poll", description: "vote", category: "social" },
];

describe("buildPrompt", () => {
  test("embeds the raw idea", () => {
    const { prompt } = buildPrompt({ prompt: "a tip jar" });
    expect(prompt).toContain('User idea: "a tip jar"');
  });

  test("threads prior Q/A back in (stateless)", () => {
    const { prompt } = buildPrompt({
      prompt: "a game",
      answers: [{ q: "mechanic?", a: "tapping" }],
    });
    expect(prompt).toContain("Clarifications so far:");
    expect(prompt).toContain("Q: mechanic?");
    expect(prompt).toContain("A: tapping");
  });

  test("renders the base spec for remixes", () => {
    const { prompt } = buildPrompt({ prompt: "make it dark", baseSpec: SPEC });
    expect(prompt).toContain("BASE SPEC");
    expect(prompt).toContain("tip-jar");
  });

  test("injects the catalog into the system prompt only when present", () => {
    const without = buildPrompt({ prompt: "x" });
    expect(without.system).not.toContain("already listed on SuperJam");

    const withCatalog = buildPrompt({ prompt: "x", catalog: CATALOG });
    expect(withCatalog.system).toContain("already listed on SuperJam");
    expect(withCatalog.system).toContain("tip-jar | Tip Jar");
    expect(withCatalog.system).toContain("poll | Poll");
  });

  test("notes attached files so the model reads them (they ride as content parts)", () => {
    const { prompt } = buildPrompt({
      prompt: "an infographic",
      attachments: [{ mediaType: "text/csv", data: new Uint8Array([1, 2, 3]) }],
    });
    expect(prompt).toContain("ATTACHED FILES");
    expect(prompt).toContain("1 file(s)");
  });
});

describe("filterSimilar", () => {
  test("drops slugs that aren't real listed apps", () => {
    const out = filterSimilar(
      specResult([
        { slug: "tip-jar", reason: "same idea" },
        { slug: "hallucinated", reason: "made up" },
      ]),
      CATALOG
    );
    expect(out.similar).toEqual([{ slug: "tip-jar", reason: "same idea" }]);
  });

  test("drops the field entirely when nothing survives", () => {
    const out = filterSimilar(specResult([{ slug: "ghost", reason: "x" }]), CATALOG);
    expect(out.similar).toBeUndefined();
  });

  test("caps to SIMILAR_MAX", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      slug: `app-${i}`,
      reason: "dup",
    }));
    const cat = many.map((m) => ({
      slug: m.slug,
      name: m.slug,
      description: "d",
      category: "tool",
    }));
    const out = filterSimilar(specResult(many), cat);
    expect(out.similar).toHaveLength(3);
  });

  test("no catalog ⇒ all similar dropped", () => {
    const out = filterSimilar(specResult([{ slug: "tip-jar", reason: "x" }]));
    expect(out.similar).toBeUndefined();
  });

  test("leaves a clean result untouched", () => {
    const out = filterSimilar(specResult(), CATALOG);
    expect(out).toEqual(specResult());
  });
});

describe("refine", () => {
  test("passes the spec branch through and filters similar", async () => {
    const generate: RefineGenerator = async () =>
      specResult([
        { slug: "tip-jar", reason: "same" },
        { slug: "nope", reason: "fake" },
      ]);
    const out = await refine({ prompt: "tip jar", catalog: CATALOG }, { generate });
    expect(out.type).toBe("spec");
    expect(out.similar).toEqual([{ slug: "tip-jar", reason: "same" }]);
  });

  test("returns the questions branch verbatim", async () => {
    const questions: RefineResult = {
      type: "questions",
      questions: [{ q: "what kind?", options: ["a", "b"] }],
    };
    const generate: RefineGenerator = async () => questions;
    const out = await refine({ prompt: "vague" }, { generate });
    expect(out).toEqual(questions);
  });

  test("feeds the assembled prompt to the generator", async () => {
    let seen: { system: string; prompt: string } | undefined;
    const generate: RefineGenerator = async (args) => {
      seen = args;
      return specResult();
    };
    await refine({ prompt: "remix it", baseSpec: SPEC, catalog: CATALOG }, { generate });
    expect(seen?.prompt).toContain("BASE SPEC");
    expect(seen?.system).toContain("tip-jar | Tip Jar");
  });
});
