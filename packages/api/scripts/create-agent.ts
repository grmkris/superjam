#!/usr/bin/env bun
// Create builder agent(s) the SAME way the website register does — via the shared
// `createBuilderAgent` (clash → insert row → provision ENS + ERC-8004 + StakeSlash
// stake + AgentBook detect). DB-direct (the box has DB access), so no auth gate.
// This is the platform's fleet seeder AND the engine a Claude Code skill wraps.
//
//   DEV_DB_URL=<url> bun packages/api/scripts/create-agent.ts            # seed the fleet
//   (reads ENS_V2_* / STAKE_SLASH_ADDRESS / ERC8004_REGISTRY / SEPOLIA/ARC RPC from .env)
import { createDb, schema } from "@superjam/db";
import { createOnchainFromConfig, nullOnchain } from "@superjam/onchain";
import { eq } from "drizzle-orm";
import { createAgentIdentity } from "../src/lib/agent-identity-impl.ts";
import { createBuilderAgent, refreshAgentIdentity } from "../src/routers/agents.ts";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}

// `--refresh`: re-provision EXISTING agents (backfill a missing ERC-8004 id / ENS /
// stake) instead of skipping them. Idempotent — nothing double-mints.
const REFRESH = process.argv.includes("--refresh");

// The platform fleet — 3 differentiated human-backed builder agents. Each wallet
// is a distinct Dynamic MPC wallet (provisioned separately). Capabilities gate
// routing (selectEligibleBuilder); model is forwarded to the builder per build.
const BUILDER_URL = process.env.BUILDER_URL ?? "https://sjbuilder.37.60.232.68.sslip.io";
const BUILDER_TOKEN = process.env.BUILDER_TOKEN ?? "house";
const FLEET = [
  {
    slug: "pro",
    name: "SuperJam Pro",
    model: "claude-opus-4-8",
    priceUsdc: "0.05",
    capabilities: ["frontend", "contracts:evm", "database:neon", "hosting:vercel", "ai"],
    walletAddress: "0x04159e595fb7A0D93b387c76ABDDD49A29adfB0a",
  },
  {
    slug: "standard",
    name: "SuperJam Standard",
    model: "claude-opus-4-8",
    priceUsdc: "0.02",
    capabilities: ["frontend", "database:neon", "hosting:vercel", "ai"],
    walletAddress: "0x153a0B1fF2b885Bf11f55C7cAb6ca054D4A0a5fa",
  },
  {
    slug: "lite",
    name: "SuperJam Lite",
    model: "claude-sonnet-4-6",
    priceUsdc: "0.01",
    capabilities: ["frontend", "hosting:vercel"],
    walletAddress: "0x4e79f7c6b858a2753cA6D2402a0CDa68ACCb2Fc3",
  },
] as const;

// Single-agent mode (what the Claude Code `register-builder` skill drives): set
// AGENT_SLUG (+ the rest) to register ONE arbitrary builder instead of the fleet.
// The same `createBuilderAgent` path — so a skill-driven registration is byte-for-
// byte the community/website registration. The wallet is provided (a Dynamic MPC
// wallet, recommended; or any address the operator controls).
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
      model: process.env.AGENT_MODEL ?? "claude-opus-4-8",
      priceUsdc: process.env.AGENT_PRICE ?? "1",
      capabilities: (process.env.AGENT_CAPS ?? "frontend,hosting:vercel")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      walletAddress: wallet,
    },
  ];
};

// Either ONE agent from the env (skill mode) or the whole platform fleet.
const AGENTS: readonly {
  slug: string;
  name: string;
  model: string;
  priceUsdc: string;
  capabilities: readonly string[];
  walletAddress: string;
}[] = fromEnv() ?? FLEET;

const onchain =
  createOnchainFromConfig({
    serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
    arcRpcUrl: process.env.ARC_RPC_URL,
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL,
    ensV2: process.env.ENS_V2_REGISTRY
      ? { registry: process.env.ENS_V2_REGISTRY as `0x${string}` }
      : undefined,
    ensV2SignerKey: process.env.ENS_V2_SIGNER_KEY,
    erc8004: process.env.ERC8004_REGISTRY
      ? { identityRegistry: process.env.ERC8004_REGISTRY as `0x${string}` }
      : undefined,
    stakeSlashAddress: process.env.STAKE_SLASH_ADDRESS,
    worldchainRpcUrl: process.env.WORLDCHAIN_RPC_URL,
    agentBookAddress: process.env.AGENTBOOK_ADDRESS,
  }) ?? nullOnchain;
console.log(`onchain: ${onchain === nullOnchain ? "NULL (identity skipped)" : "live (ENS+8004+stake)"}`);

const logger = {
  warn: (o: unknown, m: string) => console.log("[warn]", m, o),
  info: () => {},
  error: (o: unknown, m: string) => console.log("[error]", m, o),
  debug: () => {},
  child: () => logger,
} as never;

const { db, pool } = createDb(DEV_DB_URL);

// The human backer — a platform @superjam account (real logins keep their own
// usernames). Idempotent.
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
    if (!REFRESH) {
      console.log(`\n${a.slug}: already exists (${existing.id}) — skipping`);
      continue;
    }
    console.log(`\n=== refresh ${a.name} (${a.slug}) ===`);
    const updated = await refreshAgentIdentity(
      { db, agentIdentity: createAgentIdentity(onchain), logger },
      existing,
      { username: owner!.username, walletAddress: owner!.walletAddress }
    );
    console.log(`  ens:     ${updated.ensName ?? "(skipped)"}`);
    console.log(`  erc8004: ${updated.erc8004Id ?? "(skipped)"}`);
    console.log(`  staked:  ${updated.stakedUsdc ?? "(skipped)"} USDC`);
    continue;
  }
  console.log(`\n=== ${a.name} (${a.slug}, ${a.model}, ${a.priceUsdc} USDC) ===`);
  try {
    const agent = await createBuilderAgent(
      { db, agentIdentity: createAgentIdentity(onchain), logger },
      {
        name: a.name,
        slug: a.slug,
        endpointUrl: BUILDER_URL,
        token: BUILDER_TOKEN,
        priceUsdc: a.priceUsdc,
        model: a.model,
        capabilities: [...a.capabilities] as never,
        walletAddress: a.walletAddress.toLowerCase(),
      },
      { id: owner!.id, username: owner!.username, walletAddress: owner!.walletAddress }
    );
    console.log(`  wallet:  ${a.walletAddress}`);
    console.log(`  ens:     ${agent.ensName ?? "(skipped)"}`);
    console.log(`  erc8004: ${agent.erc8004Id ?? "(skipped)"}`);
    console.log(`  staked:  ${agent.stakedUsdc ?? "(skipped)"} USDC  tx ${agent.stakeTxHash ?? "-"}`);
    console.log(`  → optional human-back: npx @worldcoin/agentkit-cli register ${a.walletAddress}`);
  } catch (err) {
    console.error(`  FAILED:`, String((err as Error)?.message ?? err));
  }
}

console.log("\ndone.");
await pool.end();
