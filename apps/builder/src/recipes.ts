// Recipe corpus selection — the repo's canonical "how to build app type X" patterns
// (apps/builder/recipes/*.md), fed into the in-memory build loop's system prompt so the
// model's archetype guidance is grounded in the actual recipe files.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSpec } from "@superjam/shared";

export const RECIPES_DIR = join(import.meta.dir, "..", "recipes");

/**
 * Choose which recipes to feed the agent. `_base` + `INDEX` always; archetypes by skill,
 * category, and keyword (keywords cover archetypes the SkillName enum doesn't name yet —
 * quiz/predict/data/realtime/social).
 */
export const selectRecipes = (spec: AppSpec): string[] => {
  const want = new Set<string>(["_base", "INDEX"]);
  for (const s of spec.skills ?? []) {
    if (s === "game-2d" || s === "game-3d") want.add("game");
    else if (s === "charts") want.add("poll-charts");
    else if (s === "judge") want.add("judge");
    else if (s === "market") want.add("market");
    else if (s === "map") want.add("map");
    else if (s === "onchain") want.add("onchain");
  }
  if (spec.category === "game") want.add("game");
  if (spec.category === "social") want.add("social");
  const hay = `${spec.name} ${spec.description} ${spec.features.join(" ")}`.toLowerCase();
  const kw: [RegExp, string][] = [
    [/quiz|trivia/, "quiz"],
    [/predict|sweepstake|forecast/, "predict"],
    [/\bbet\b|pot|wager|market|stake/, "market"],
    [/vote|poll|survey/, "poll-charts"],
    [/csv|spreadsheet|dataset|data set|analy/, "data"],
    [/live|real-?time|multiplayer/, "realtime"],
    [/trip|travel|itinerary|vacation|holiday|tour|destination/, "travel"],
    [/\bmap\b|atlas|geo|location|marker/, "map"],
    [/wall|guestbook|feed|\bpost\b/, "social"],
    [/draw|photo|judge|contest|\brate\b/, "judge"],
    [/game|arcade|clicker|score/, "game"],
    [/onchain|on-chain|\bchain\b|coin\s?flip|\bdice\b|\bnft\b|mint|token|smart contract|solidity/, "onchain"],
  ];
  for (const [re, r] of kw) if (re.test(hay)) want.add(r);
  // travel apps render on the map → always include the map component contract.
  if (want.has("travel")) want.add("map");
  return [...want];
};

/** Concatenated recipe markdown for a spec (missing files are skipped). */
export const loadRecipes = async (spec: AppSpec): Promise<string> => {
  const parts = await Promise.all(
    selectRecipes(spec).map(async (n) => {
      try {
        return await readFile(join(RECIPES_DIR, `${n}.md`), "utf8");
      } catch {
        return "";
      }
    })
  );
  return parts.filter(Boolean).join("\n\n---\n\n");
};
