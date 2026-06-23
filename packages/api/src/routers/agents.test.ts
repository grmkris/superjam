import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import type { AppSpec, BuilderCapability } from "@superjam/shared";
import { typeIdGenerator } from "@superjam/shared";
import type { Database } from "@superjam/db";
import type { AgentIdentity } from "../lib/agent-identity.ts";
import { nullAgentIdentity } from "../lib/agent-identity.ts";
import { createTestUser } from "../testing/factories.ts";

import {
  createBuilderAgent,
  type CreateBuilderAgentInput,
  selectEligibleBuilder,
} from "./agents.ts";

// Minimal AppSpec — selectEligibleBuilder keeps the arg for signature stability.
const specWith = (over: Partial<AppSpec> = {}): AppSpec => ({
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
const SPEC_NEEDS_DB = specWith({
  data: {
    collections: [{ name: "scores", fields: [{ name: "v", type: "number" }], writtenWhen: "x" }],
    counters: [],
    storage: [],
  },
});

const logger = createLogger({ level: "silent" });

const REGISTER: CreateBuilderAgentInput = {
  name: "Toybox Builder",
  slug: "toybox-builder",
  endpointUrl: "https://builder.superjam.fun/dispatch",
  token: "secret-builder-token",
  priceUsdc: "1",
  capabilities: ["frontend", "hosting:vercel", "database:neon"] as BuilderCapability[],
  walletAddress: "0x" + "a".repeat(40),
};

const harness = async () => {
  const { db } = await createPgliteDb();
  // Seed a builder the SAME way the fleet seeder does — the shared createBuilderAgent
  // path (insert row + best-effort onchain identity).
  const seed = async (
    over: Partial<CreateBuilderAgentInput> = {},
    identity: AgentIdentity = nullAgentIdentity
  ) => {
    const owner = await createTestUser(db, { worldVerified: true });
    return createBuilderAgent(
      { db: db as Database, agentIdentity: identity, logger },
      { ...REGISTER, ...over },
      { id: owner.id, username: owner.username, walletAddress: owner.walletAddress }
    );
  };
  return { db: db as Database, seed };
};

describe("createBuilderAgent (the shared seeding path)", () => {
  test("inserts an active builder row", async () => {
    const { seed } = await harness();
    const agent = await seed();
    expect(agent.slug).toBe("toybox-builder");
    expect(agent.capabilities).toEqual(["frontend", "hosting:vercel", "database:neon"]);
    expect(agent.walletAddress).toBe(REGISTER.walletAddress);
    expect(agent.status).toBe("active");
  });

  test("a duplicate slug is a CONFLICT", async () => {
    const { seed } = await harness();
    await seed();
    await expect(seed()).rejects.toBeInstanceOf(ORPCError);
  });

  test("attaches the ENS name from the onchain identity seam (best-effort)", async () => {
    const { db } = await harness();
    const owner = await createTestUser(db, { worldVerified: true, username: "maria" });
    const identity: AgentIdentity = {
      provision: ({ slug, ownerUsername }) =>
        Promise.resolve({ ensName: `${slug}.${ownerUsername}.superjam.eth` }),
    };
    const agent = await createBuilderAgent(
      { db, agentIdentity: identity, logger },
      REGISTER,
      { id: owner.id, username: owner.username, walletAddress: owner.walletAddress }
    );
    expect(agent.ensName).toBe("toybox-builder.maria.superjam.eth");
  });

  test("stores the ERC-8004 id from the identity seam (§16)", async () => {
    const { db } = await harness();
    const owner = await createTestUser(db, { worldVerified: true, username: "neo" });
    const identity: AgentIdentity = {
      provision: ({ slug, ownerUsername }) =>
        Promise.resolve({
          ensName: `${slug}.${ownerUsername}.superjam.eth`,
          erc8004Id: "8004:7",
        }),
    };
    const agent = await createBuilderAgent(
      { db, agentIdentity: identity, logger },
      REGISTER,
      { id: owner.id, username: owner.username, walletAddress: owner.walletAddress }
    );
    expect(agent.erc8004Id).toBe("8004:7");
  });

  test("a failing identity seam never fails seeding", async () => {
    const { db } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const identity: AgentIdentity = {
      provision: () => Promise.reject(new Error("RPC down")),
    };
    const agent = await createBuilderAgent(
      { db, agentIdentity: identity, logger },
      REGISTER,
      { id: owner.id, username: owner.username, walletAddress: owner.walletAddress }
    );
    expect(agent.slug).toBe("toybox-builder");
    expect(agent.ensName).toBeNull();
  });
});

describe("selectEligibleBuilder (the build-dispatch pick)", () => {
  test("auto-pick returns the preferred (cheapest) active builder, regardless of spec", async () => {
    const h = await harness();
    await h.seed(); // priceUsdc "1"
    const fe = await h.seed({ slug: "fe-only", priceUsdc: "0" });
    // Dispatch isn't capability-gated, so even a data spec routes to the cheapest.
    const chosen = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB);
    expect(chosen?.agent.id).toBe(fe.id); // fe is priceUsdc "0"
  });

  test("an explicit agentId is honored for any active builder", async () => {
    const h = await harness();
    const fe = await h.seed({ slug: "fe-only", priceUsdc: "0" });
    const chosen = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB, { agentId: fe.id });
    expect(chosen?.agent.id).toBe(fe.id);
    expect(chosen?.endpointUrl).toBe(REGISTER.endpointUrl);
    expect(chosen?.token).toBe(REGISTER.token);
  });

  test("an unknown/disabled agentId is a hard miss (null), not a silent reroute", async () => {
    const h = await harness();
    const full = await h.seed();
    const unknown = typeIdGenerator("builderAgent") as typeof full.id;
    const miss = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB, { agentId: unknown });
    expect(miss).toBeNull();
  });

  test("returns null when there are no active builders", async () => {
    const h = await harness();
    const none = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB);
    expect(none).toBeNull();
  });
});
