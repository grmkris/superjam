#!/usr/bin/env bun
// Seed the house builder row (DB-direct — the box has DB access, no auth gate) via
// the shared `createBuilderAgent`. Builds auto-route to whatever active builder
// exists (selectEligibleBuilder), so the platform just needs ONE active row.
//
//   DEV_DB_URL=<url> bun packages/api/scripts/create-agent.ts            # seed the house builder
import { createDb, schema } from "@superjam/db";
import { eq } from "drizzle-orm";
import { createBuilderAgent } from "../src/routers/agents.ts";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}

// The single house builder. Dispatch isn't capability-gated and the coding model is
// chosen on the builder box (not per-row), so one active row is all the platform needs.
const BUILDER_URL = process.env.BUILDER_URL ?? "https://sjbuilder.37.60.232.68.sslip.io";
const BUILDER_TOKEN = process.env.BUILDER_TOKEN ?? "house";
const FLEET = [
  {
    slug: "superjam",
    name: "SuperJam",
    priceUsdc: "0",
    capabilities: ["frontend", "database:neon", "hosting:vercel", "contracts:evm", "ai"],
    walletAddress: "0x56592bA38D41370Fc0ebb43a02274709084c9904",
  },
] as const;

// Single-agent mode (what the Claude Code `register-builder` skill drives): set
// AGENT_SLUG (+ the rest) to register ONE arbitrary builder instead of the house row.
const fromEnv = () => {
  const slug = process.env.AGENT_SLUG;
  if (!slug) return null;
  const wallet = process.env.AGENT_WALLET;
  if (!wallet) {
    console.error("AGENT_SLUG set but AGENT_WALLET missing");
    process.exit(2);
  }
  return [
    {
      slug,
      name: process.env.AGENT_NAME ?? slug,
      priceUsdc: process.env.AGENT_PRICE ?? "1",
      capabilities: (process.env.AGENT_CAPS ?? "frontend,hosting:vercel")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      walletAddress: wallet,
    },
  ];
};

// Either ONE agent from the env (skill mode) or the house builder.
const AGENTS: readonly {
  slug: string;
  name: string;
  priceUsdc: string;
  capabilities: readonly string[];
  walletAddress: string;
}[] = fromEnv() ?? FLEET;

const { db, pool } = createDb(DEV_DB_URL);

// The owner — a platform @superjam account (real logins keep their own usernames).
// Idempotent.
let [owner] = await db
  .select()
  .from(schema.user)
  .where(eq(schema.user.username, "superjam"));
if (!owner) {
  [owner] = await db
    .insert(schema.user)
    .values({
      username: "superjam",
      email: "platform@superjam.fun",
      walletAddress: "0x56592bA38D41370Fc0ebb43a02274709084c9904",
      worldVerified: true,
    })
    .returning();
  console.log("created platform owner @superjam", owner!.id);
} else {
  console.log("owner @superjam exists", owner.id);
}

for (const a of AGENTS) {
  const existing = await db.query.builderAgent.findFirst({
    where: eq(schema.builderAgent.slug, a.slug),
  });
  if (existing) {
    console.log(`\n${a.slug}: already exists (${existing.id}) — skipping`);
    continue;
  }
  console.log(`\n=== ${a.name} (${a.slug}, ${a.priceUsdc} USDC) ===`);
  try {
    const agent = await createBuilderAgent(
      { db },
      {
        name: a.name,
        slug: a.slug,
        endpointUrl: BUILDER_URL,
        token: BUILDER_TOKEN,
        priceUsdc: a.priceUsdc,
        capabilities: [...a.capabilities] as never,
        walletAddress: a.walletAddress.toLowerCase(),
      },
      { id: owner!.id }
    );
    console.log(`  created ${agent.id}  wallet ${a.walletAddress}`);
  } catch (err) {
    console.error(`  FAILED:`, String((err as Error)?.message ?? err));
  }
}

console.log("\ndone.");
await pool.end();
