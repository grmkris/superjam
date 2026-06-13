import { describe, expect, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import type { AppSpec, BuilderCapability } from "@superjam/shared";
import { typeIdGenerator } from "@superjam/shared";
import type { AgentIdentity } from "../lib/agent-identity.ts";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createTestUser } from "../testing/factories.ts";
import {
  agentsRouter,
  findEligibleBuilders,
  selectEligibleBuilder,
} from "./agents.ts";

// Minimal AppSpec — requiredCapabilities only reads data/payments/ai/capabilities.
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
    collections: [{ name: "scores", doc: { v: "number" }, writtenWhen: "x" }],
    counters: [],
    storage: [],
  },
});

const logger = createLogger({ level: "silent" });

const REGISTER = {
  name: "Toybox Builder",
  slug: "toybox-builder",
  endpointUrl: "https://builder.superjam.fun/dispatch",
  token: "secret-builder-token",
  priceUsdc: "1",
  capabilities: ["frontend", "hosting:vercel", "database:neon"] as BuilderCapability[],
  walletAddress: "0x" + "a".repeat(40),
};

const harness = async () => {
  const { db, client } = await createPgliteDb();
  const auth = await createTestAuth();
  const rateLimiter = createRateLimiter();
  const ctxFor = (token?: string, agentIdentity?: AgentIdentity) => ({
    ...createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    ...(agentIdentity ? { agentIdentity } : {}),
  });
  const signIn = (u: { dynamicUserId: string | null; email: string }) =>
    auth.sign({ dynamicUserId: u.dynamicUserId!, email: u.email });
  return { db, client, ctxFor, signIn };
};

describe("agents.register", () => {
  test("a verified human registers a capability-attested agent (token never leaks)", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const agent = await call(agentsRouter.register, REGISTER, {
      context: ctxFor(await signIn(owner)),
    });
    expect(agent.slug).toBe("toybox-builder");
    expect(agent.ownerUserId).toBe(owner.id);
    expect(agent.capabilities).toEqual(["frontend", "hosting:vercel", "database:neon"]);
    expect(agent.walletAddress).toBe(REGISTER.walletAddress);
    expect(agent.status).toBe("active");
    expect(agent).not.toHaveProperty("token");
  });

  test("registration is gated on World verification", async () => {
    const { db, ctxFor, signIn } = await harness();
    const unverified = await createTestUser(db, { worldVerified: false });
    await expect(
      call(agentsRouter.register, REGISTER, { context: ctxFor(await signIn(unverified)) })
    ).rejects.toBeInstanceOf(ORPCError);
  });

  test("a duplicate slug is a CONFLICT", async () => {
    const { db, ctxFor, signIn } = await harness();
    const a = await createTestUser(db, { worldVerified: true });
    const b = await createTestUser(db, { worldVerified: true });
    await call(agentsRouter.register, REGISTER, { context: ctxFor(await signIn(a)) });
    await expect(
      call(agentsRouter.register, REGISTER, { context: ctxFor(await signIn(b)) })
    ).rejects.toBeInstanceOf(ORPCError);
  });

  test("dedupes declared capabilities and rejects an empty set", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const token = await signIn(owner);
    const agent = await call(
      agentsRouter.register,
      { ...REGISTER, capabilities: ["frontend", "frontend", "ai"] as BuilderCapability[] },
      { context: ctxFor(token) }
    );
    expect(agent.capabilities).toEqual(["frontend", "ai"]);
    await expect(
      call(
        agentsRouter.register,
        { ...REGISTER, slug: "empty-caps", capabilities: [] as BuilderCapability[] },
        { context: ctxFor(token) }
      )
    ).rejects.toBeInstanceOf(ORPCError);
  });

  test("attaches the ENS name from the onchain identity seam (best-effort)", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true, username: "maria" });
    const identity: AgentIdentity = {
      provision: ({ slug, ownerUsername }) =>
        Promise.resolve({ ensName: `${slug}.${ownerUsername}.superjam.eth` }),
    };
    const agent = await call(agentsRouter.register, REGISTER, {
      context: ctxFor(await signIn(owner), identity),
    });
    expect(agent.ensName).toBe("toybox-builder.maria.superjam.eth");
  });

  test("stores the ERC-8004 id from the identity seam (§16)", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true, username: "neo" });
    const identity: AgentIdentity = {
      provision: ({ slug, ownerUsername }) =>
        Promise.resolve({
          ensName: `${slug}.${ownerUsername}.superjam.eth`,
          erc8004Id: "8004:7",
        }),
    };
    const agent = await call(agentsRouter.register, REGISTER, {
      context: ctxFor(await signIn(owner), identity),
    });
    expect(agent.erc8004Id).toBe("8004:7");
    // persisted: the public profile reads it back from the DB.
    const fetched = await call(
      agentsRouter.get,
      { agentId: agent.id },
      { context: ctxFor() }
    );
    expect(fetched.erc8004Id).toBe("8004:7");
  });

  test("a failing identity seam never fails registration", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const identity: AgentIdentity = {
      provision: () => Promise.reject(new Error("RPC down")),
    };
    const agent = await call(agentsRouter.register, REGISTER, {
      context: ctxFor(await signIn(owner), identity),
    });
    expect(agent.slug).toBe("toybox-builder");
    expect(agent.ensName).toBeNull();
  });
});

describe("agents.list / mine / disable", () => {
  test("list returns active agents only, busiest first", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const token = await signIn(owner);
    await call(agentsRouter.register, REGISTER, { context: ctxFor(token) });
    const second = await call(
      agentsRouter.register,
      { ...REGISTER, slug: "art-builder", name: "Maria's Art Builder" },
      { context: ctxFor(token) }
    );

    // disabled agents drop out of the marketplace.
    await call(agentsRouter.disable, { agentId: second.id }, { context: ctxFor(token) });

    const list = await call(agentsRouter.list, {}, { context: ctxFor() });
    expect(list).toHaveLength(1);
    expect(list[0]!.slug).toBe("toybox-builder");
  });

  test("mine returns only the caller's agents", async () => {
    const { db, ctxFor, signIn } = await harness();
    const a = await createTestUser(db, { worldVerified: true });
    const b = await createTestUser(db, { worldVerified: true });
    await call(agentsRouter.register, REGISTER, { context: ctxFor(await signIn(a)) });
    await call(
      agentsRouter.register,
      { ...REGISTER, slug: "b-builder" },
      { context: ctxFor(await signIn(b)) }
    );
    const mine = await call(agentsRouter.mine, {}, { context: ctxFor(await signIn(b)) });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.slug).toBe("b-builder");
  });

  test("only the owner can disable an agent", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const stranger = await createTestUser(db, { worldVerified: true });
    const agent = await call(agentsRouter.register, REGISTER, {
      context: ctxFor(await signIn(owner)),
    });
    await expect(
      call(agentsRouter.disable, { agentId: agent.id }, { context: ctxFor(await signIn(stranger)) })
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("findEligibleBuilders (S's routing primitive)", () => {
  test("returns only active agents that hold every required capability", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const token = await signIn(owner);
    // a full-stack builder
    await call(agentsRouter.register, REGISTER, { context: ctxFor(token) });
    // a frontend-only builder
    await call(
      agentsRouter.register,
      {
        ...REGISTER,
        slug: "fe-only",
        capabilities: ["frontend", "hosting:vercel"] as BuilderCapability[],
      },
      { context: ctxFor(token) }
    );

    const needsDb = await findEligibleBuilders(db, ["frontend", "database:neon"]);
    expect(needsDb.map((a) => a.slug)).toEqual(["toybox-builder"]);

    const needsFe = await findEligibleBuilders(db, ["frontend"]);
    expect(needsFe.map((a) => a.slug).toSorted()).toEqual(["fe-only", "toybox-builder"]);

    const needsContracts = await findEligibleBuilders(db, ["contracts:evm"]);
    expect(needsContracts).toHaveLength(0);
  });
});

describe("selectEligibleBuilder (the build-dispatch pick)", () => {
  // Register a full-stack builder + a cheaper frontend-only one.
  const seed = async (h: Awaited<ReturnType<typeof harness>>) => {
    const owner = await createTestUser(h.db, { worldVerified: true });
    const token = await h.signIn(owner);
    const full = await call(agentsRouter.register, REGISTER, { context: h.ctxFor(token) });
    const fe = await call(
      agentsRouter.register,
      {
        ...REGISTER,
        slug: "fe-only",
        priceUsdc: "0",
        capabilities: ["frontend", "hosting:vercel"] as BuilderCapability[],
      },
      { context: h.ctxFor(token) }
    );
    return { full, fe };
  };

  test("a data spec routes only to a capable builder (frontend-only excluded)", async () => {
    const h = await harness();
    const { full } = await seed(h);
    const chosen = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB);
    expect(chosen?.agent.id).toBe(full.id);
    expect(chosen?.endpointUrl).toBe(REGISTER.endpointUrl);
    expect(chosen?.token).toBe(REGISTER.token);
  });

  test("a static spec prefers the cheaper eligible builder", async () => {
    const h = await harness();
    const { fe } = await seed(h);
    const chosen = await selectEligibleBuilder(h.db, specWith());
    expect(chosen?.agent.id).toBe(fe.id); // fe is priceUsdc "0"
  });

  test("an explicit agentId is honored when eligible, refused when not", async () => {
    const h = await harness();
    const { full, fe } = await seed(h);
    const ok = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB, { agentId: full.id });
    expect(ok?.agent.id).toBe(full.id);
    // fe can't do database:neon → a hard miss, not a silent reroute
    const miss = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB, { agentId: fe.id });
    expect(miss).toBeNull();
  });

  test("returns null when no active builder can deliver", async () => {
    const h = await harness();
    await seed(h);
    const needsContracts = await selectEligibleBuilder(
      h.db,
      specWith({ capabilities: ["payments"] }) // → requires contracts:evm
    );
    expect(needsContracts).toBeNull();
  });
});

describe("agents.get", () => {
  test("returns the builder + its human backer (@username, ✓-human)", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const agent = await call(agentsRouter.register, REGISTER, {
      context: ctxFor(await signIn(owner)),
    });
    const got = await call(
      agentsRouter.get,
      { agentId: agent.id },
      { context: ctxFor() } // public — no token
    );
    expect(got.id).toBe(agent.id);
    expect(got.name).toBe(REGISTER.name);
    expect(got.owner.username).toBe(owner.username);
    expect(got.owner.worldVerified).toBe(true);
    expect(got).not.toHaveProperty("token");
  });

  test("unknown builder → NOT_FOUND", async () => {
    const { ctxFor } = await harness();
    await expect(
      call(
        agentsRouter.get,
        { agentId: typeIdGenerator("builderAgent") },
        { context: ctxFor() }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
