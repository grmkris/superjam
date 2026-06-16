import { describe, expect, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import type { AppSpec, BuilderCapability } from "@superjam/shared";
import { typeIdGenerator } from "@superjam/shared";
import { type Onchain, type Usdc, usdc } from "@superjam/onchain";
import type { Address, Hex } from "viem";
import type { AgentIdentity } from "../lib/agent-identity.ts";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createMockOnchain } from "../testing/onchain-mock.ts";
import { createTestUser } from "../testing/factories.ts";

// A mock Onchain whose StakeSlash is backed by an in-memory stake balance, so the
// staking procedures (depositFor / stakeOf / accruedYield / stakeViaCctp) are
// exercisable without a chain. `stakeBridges` (from createMockOnchain) records the
// cross-chain top-up; `state.staked` accumulates same-chain + the re-read.
const HASH = ("0x" + "1".repeat(64)) as Hex;
const onchainWithStake = (state: { staked: bigint }): Onchain => {
  const mock = createMockOnchain();
  return {
    ...mock,
    stakeSlash: {
      depositFor: async (_b: Address, amount: Usdc) => {
        state.staked += amount;
        return HASH;
      },
      stakeOf: async () => usdc(state.staked),
      freeStake: async () => usdc(state.staked),
      accruedYield: async () => usdc(120_000n), // 0.12 USDC pool yield
      deposit: async () => HASH,
      withdraw: async () => HASH,
      registerBuild: async () => HASH,
      markDelivered: async () => HASH,
      resolve: async () => HASH,
      getBuild: async () => null,
    },
    // stakeViaCctp credits the same in-memory stake so the re-read reflects it.
    stakeViaCctp: async ({ amount }: { builder: Address; amount: Usdc }) => {
      state.staked += amount;
      return { burnTxHash: HASH, mintTxHash: HASH, staked: usdc(amount) };
    },
  } as unknown as Onchain;
};
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
    collections: [{ name: "scores", fields: [{ name: "v", type: "number" }], writtenWhen: "x" }],
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
  const ctxFor = (
    token?: string,
    agentIdentity?: AgentIdentity,
    onchain?: Onchain
  ) => ({
    ...createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      ...(onchain ? { onchain } : {}),
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

  test("any logged-in user can register (no World gate)", async () => {
    const { db, ctxFor, signIn } = await harness();
    const owner = await createTestUser(db, { worldVerified: false });
    const agent = await call(agentsRouter.register, REGISTER, {
      context: ctxFor(await signIn(owner)),
    });
    expect(agent.slug).toBe("toybox-builder");
    expect(agent.ownerUserId).toBe(owner.id);
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

  test("auto-pick returns the preferred (cheapest) active builder, regardless of spec", async () => {
    const h = await harness();
    const { fe } = await seed(h);
    // Dispatch isn't capability-gated, so even a data spec routes to the cheapest.
    const chosen = await selectEligibleBuilder(h.db, SPEC_NEEDS_DB);
    expect(chosen?.agent.id).toBe(fe.id); // fe is priceUsdc "0"
  });

  test("an explicit agentId is honored for any active builder, even a frontend-only one on a data+payments spec", async () => {
    const h = await harness();
    const { fe } = await seed(h);
    // Previously a hard miss (fe lacks database:neon/contracts:evm); dispatch is no
    // longer capability-gated, so the user's pick goes through.
    const dataPaySpec = specWith({ capabilities: ["payments"], data: SPEC_NEEDS_DB.data });
    const chosen = await selectEligibleBuilder(h.db, dataPaySpec, { agentId: fe.id });
    expect(chosen?.agent.id).toBe(fe.id);
    expect(chosen?.endpointUrl).toBe(REGISTER.endpointUrl);
    expect(chosen?.token).toBe(REGISTER.token);
  });

  test("an unknown/disabled agentId is a hard miss (null), not a silent reroute", async () => {
    const h = await harness();
    const { full } = await seed(h);
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

describe("agents staking", () => {
  const register = async (
    h: Awaited<ReturnType<typeof harness>>,
    token: string
  ) => call(agentsRouter.register, REGISTER, { context: h.ctxFor(token) });

  test("stakeInfo reads live stake + pool yield when the escrow is configured", async () => {
    const h = await harness();
    const owner = await createTestUser(h.db, { worldVerified: true });
    const agent = await register(h, await h.signIn(owner));
    const info = await call(
      agentsRouter.stakeInfo,
      { agentId: agent.id },
      { context: h.ctxFor(undefined, undefined, onchainWithStake({ staked: 2_000_000n })) }
    );
    expect(info.live).toBe(true);
    expect(info.stakedUsdc).toBe("2");
    expect(info.poolYieldUsdc).toBe("0.12");
  });

  test("stakeInfo falls back to the DB snapshot when the escrow is null", async () => {
    const h = await harness();
    const owner = await createTestUser(h.db, { worldVerified: true });
    const agent = await register(h, await h.signIn(owner));
    const info = await call(
      agentsRouter.stakeInfo,
      { agentId: agent.id },
      { context: h.ctxFor() } // nullOnchain → no live read
    );
    expect(info.live).toBe(false);
    expect(info.poolYieldUsdc).toBeNull();
  });

  test("the owner tops up stake same-chain (sponsored depositFor)", async () => {
    const h = await harness();
    const owner = await createTestUser(h.db, { worldVerified: true });
    const token = await h.signIn(owner);
    const agent = await register(h, token);
    const state = { staked: 1_000_000n };
    const res = await call(
      agentsRouter.topUpStake,
      { agentId: agent.id, amount: "3" },
      { context: h.ctxFor(token, undefined, onchainWithStake(state)) }
    );
    expect(state.staked).toBe(4_000_000n); // 1 + 3
    expect(res.stakedUsdc).toBe("4");
  });

  test("a non-owner cannot top up stake (FORBIDDEN)", async () => {
    const h = await harness();
    const owner = await createTestUser(h.db, { worldVerified: true });
    const stranger = await createTestUser(h.db, { worldVerified: true });
    const agent = await register(h, await h.signIn(owner));
    await expect(
      call(
        agentsRouter.topUpStake,
        { agentId: agent.id, amount: "1" },
        { context: h.ctxFor(await h.signIn(stranger), undefined, onchainWithStake({ staked: 0n })) }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("cross-chain top-up bridges via CCTP + credits the stake", async () => {
    const h = await harness();
    const owner = await createTestUser(h.db, { worldVerified: true });
    const token = await h.signIn(owner);
    const agent = await register(h, token);
    const state = { staked: 0n };
    const res = await call(
      agentsRouter.topUpStakeCrossChain,
      { agentId: agent.id, amount: "2" },
      { context: h.ctxFor(token, undefined, onchainWithStake(state)) }
    );
    expect(res.mintTxHash).toBe(HASH);
    expect(res.stakedUsdc).toBe("2");
    expect(state.staked).toBe(2_000_000n);
  });
});
