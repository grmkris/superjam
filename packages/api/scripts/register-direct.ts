#!/usr/bin/env bun
// One-off: register a deployed external app directly against a live DB, the same
// way registerExternal/builds do — createExternalApp(db, input, onchain, logger).
// Bypasses the auth gate (we have DB access) AND runs the ENS mint locally from
// this box's .env creds (so it works even though ENS_* aren't set on the Railway
// server service yet).
//
//   recon (no writes):  DEV_DB_URL=<url> bun packages/api/scripts/register-direct.ts
//   register + mint:     DEV_DB_URL=<url> OWNER=<username> RUN=1 bun packages/api/scripts/register-direct.ts
import { createDb } from "@superjam/db";
import { createOnchainFromConfig, nullOnchain } from "@superjam/onchain";
import { eq } from "drizzle-orm";
import { schema } from "@superjam/db";
import { createExternalApp } from "../src/routers/apps.ts";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}

const entryUrl = process.env.ENTRY_URL ?? "https://sj-guestbook.vercel.app";
const manifest = {
  name: "Guestbook",
  slug: "guestbook",
  description:
    "A shared guestbook — sign in, leave a message, tip the author in USDC.",
  iconEmoji: "📖",
  category: "social" as const,
  capabilities: ["payments" as const],
};

const { db, pool } = createDb(DEV_DB_URL);

const users = await db.query.user.findMany({
  columns: {
    id: true,
    username: true,
    worldVerified: true,
    walletAddress: true,
  },
  limit: 20,
});
console.log(`\nusers in dev DB (${users.length}):`);
console.table(
  users.map((u) => ({
    username: u.username,
    world: u.worldVerified,
    wallet: u.walletAddress ? `${u.walletAddress.slice(0, 10)}…` : "(none)",
  }))
);
const apps = await db.query.app.findMany({ columns: { slug: true, status: true, ensName: true } });
console.log(`apps in dev DB (${apps.length}):`, apps.map((a) => `${a.slug}[${a.status}]${a.ensName ? " " + a.ensName : ""}`).join(", ") || "(none)");

// pick the owner: $OWNER username, else the first user that has a wallet.
const owner =
  (process.env.OWNER && users.find((u) => u.username === process.env.OWNER)) ||
  users.find((u) => u.walletAddress);
console.log(
  `\nowner → ${owner ? `${owner.username} (wallet ${owner.walletAddress ? "yes" : "NO — would list un-named"})` : "NONE FOUND"}`
);

if (process.env.RUN !== "1") {
  console.log("\n(recon only — set RUN=1 [and OWNER=<username>] to register + mint ENS)");
  await pool.end();
  process.exit(0);
}
if (!owner) {
  console.error("no owner user found");
  await pool.end();
  process.exit(1);
}

// already registered? (idempotency — don't double-insert the slug)
const existing = await db.query.app.findFirst({ where: eq(schema.app.slug, manifest.slug) });
if (existing) {
  console.log(`\nslug "${manifest.slug}" already exists (${existing.id}, ${existing.status}, ens=${existing.ensName ?? "none"}) — not re-registering.`);
  await pool.end();
  process.exit(0);
}

const onchain =
  createOnchainFromConfig({
    serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
    arcRpcUrl: process.env.ARC_RPC_URL,
    // ENSv2-native (the single naming path): SuperjamRegistry on Sepolia L1.
    ensV2: process.env.ENS_V2_REGISTRY
      ? { registry: process.env.ENS_V2_REGISTRY as `0x${string}` }
      : undefined,
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL,
    ensV2SignerKey: process.env.ENS_V2_SIGNER_KEY,
  }) ?? nullOnchain;
console.log(`\nonchain: ${onchain === nullOnchain ? "NULL (no ENS mint)" : "live (ENS mint will run)"}`);

const logger = {
  warn: (o: unknown, m: string) => console.log("[warn]", m, o),
  info: () => {},
  error: (o: unknown, m: string) => console.log("[error]", m, o),
  debug: () => {},
  child: () => logger,
} as never;

console.log(`\nregistering "${manifest.name}" → ${entryUrl} (owner ${owner.username})…`);
const row = await createExternalApp(
  db,
  { manifest, entryUrl, ownerUserId: owner.id },
  onchain,
  logger
);
console.log(`\n✓ appId=${row.id}  slug=${row.slug}  status=${row.status}`);
console.log(`  ensName=${row.ensName ?? "(un-named — mint skipped/failed)"}`);
console.log(`  ensTxHash=${row.ensTxHash ?? "—"}`);
console.log(`\nNext: SUPERJAM_APP_ID=${row.id} on Vercel + redeploy, then verify the framed loop.`);
await pool.end();
