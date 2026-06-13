import { describe, expect, test } from "bun:test";
import type { AppSpec } from "./appspec.ts";
import {
  agentCanBuild,
  BuilderCapabilityList,
  eligibleAgents,
  isBuilderCapability,
  requiredCapabilities,
} from "./builder-capabilities.ts";

// Minimal AppSpec factory — only the fields requiredCapabilities reads matter.
const spec = (over: Partial<AppSpec> = {}): AppSpec => ({
  name: "Jam",
  slug: "jam",
  description: "",
  iconEmoji: "🎮",
  category: "game",
  capabilities: [],
  features: [],
  data: { collections: [], counters: [], storage: [] },
  ui: { layout: "single", sections: [] },
  acceptance: [],
  ...over,
});

describe("requiredCapabilities", () => {
  test("a static frontend needs only frontend + hosting", () => {
    expect(requiredCapabilities(spec())).toEqual(["frontend", "hosting:vercel"]);
  });

  test("collections / counters / storage pull in a database", () => {
    const withData = spec({
      data: {
        collections: [{ name: "scores", fields: [{ name: "v", type: "number" }], writtenWhen: "x" }],
        counters: [],
        storage: [],
      },
    });
    expect(requiredCapabilities(withData)).toContain("database:neon");
  });

  test("payments pull in contracts:evm, ai pulls in ai", () => {
    const rich = spec({
      capabilities: ["payments", "ai"],
      payments: { actions: [{ label: "Tip", amountUsdc: "1", to: "appTreasury" }] },
      ai: { uses: ["chat"] },
    });
    const req = requiredCapabilities(rich);
    expect(req).toContain("contracts:evm");
    expect(req).toContain("ai");
  });
});

describe("agentCanBuild / eligibleAgents", () => {
  test("an agent must hold every required capability", () => {
    expect(agentCanBuild(["frontend", "hosting:vercel"], ["frontend"])).toBe(true);
    expect(agentCanBuild(["frontend"], ["frontend", "database:neon"])).toBe(false);
  });

  test("eligibleAgents filters to capable agents", () => {
    const agents = [
      { slug: "full", capabilities: ["frontend", "hosting:vercel", "database:neon"] },
      { slug: "fe", capabilities: ["frontend", "hosting:vercel"] },
    ];
    expect(eligibleAgents(agents, ["database:neon"]).map((a) => a.slug)).toEqual(["full"]);
  });
});

describe("vocabulary guards", () => {
  test("isBuilderCapability narrows the vocabulary", () => {
    expect(isBuilderCapability("frontend")).toBe(true);
    expect(isBuilderCapability("telepathy")).toBe(false);
  });

  test("BuilderCapabilityList dedupes and rejects empties + unknowns", () => {
    expect(BuilderCapabilityList.parse(["ai", "ai", "frontend"])).toEqual(["ai", "frontend"]);
    expect(BuilderCapabilityList.safeParse([]).success).toBe(false);
    expect(BuilderCapabilityList.safeParse(["nope"]).success).toBe(false);
  });
});
