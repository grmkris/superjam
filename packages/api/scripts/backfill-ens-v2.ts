#!/usr/bin/env bun
// Backfill: re-mint every existing app + user to its ENSv2-native flat name
// (`<label>.superjam.eth`, resolvable in standard ENS tooling) — replacing the
// old non-resolving Durin 3-level names (and filling the nulls). Idempotent:
// recon (no writes) by default, RUN=1 to write. Also re-points guestbook from
// the agent signer (0x5659) to its real owner wallet.
//
//   recon:  DEV_DB_URL=<url> bun packages/api/scripts/backfill-ens-v2.ts
//   write:  DEV_DB_URL=<url> RUN=1 bun packages/api/scripts/backfill-ens-v2.ts
//
// Reads ENS_V2_REGISTRY / ENS_V2_SIGNER_KEY / SEPOLIA_RPC_URL from this box's
// .env (the agent key owns the SuperjamRegistry on Sepolia).
import { createDb, schema } from "@superjam/db";
import { type Onchain, createOnchainFromConfig, nullOnchain } from "@superjam/onchain";
import { eq } from "drizzle-orm";
import { getAddress as toChecksum } from "viem";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}
const RUN = process.env.RUN === "1";

const onchain: Onchain =
  createOnchainFromConfig({
    serverWalletPrivateKey: process.env.SERVER_WALLET_PRIVATE_KEY,
    arcRpcUrl: process.env.ARC_RPC_URL,
    ensV2: process.env.ENS_V2_REGISTRY
      ? { registry: process.env.ENS_V2_REGISTRY as `0x${string}` }
      : undefined,
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL,
    ensV2SignerKey: process.env.ENS_V2_SIGNER_KEY,
  }) ?? nullOnchain;

if (onchain === nullOnchain) {
  console.error("onchain is NULL — set ENS_V2_REGISTRY / ENS_V2_SIGNER_KEY / SEPOLIA_RPC_URL in .env");
  process.exit(2);
}

const { db, pool } = createDb(DEV_DB_URL);
const eq2 = (addr: string, b: string) => {
  try {
    return toChecksum(addr as `0x${string}`) === toChecksum(b as `0x${string}`);
  } catch {
    return false;
  }
};

// --- load ---
const users = await db.query.user.findMany({
  columns: { id: true, username: true, walletAddress: true, ensName: true },
});
const apps = await db.query.app.findMany({
  columns: { id: true, slug: true, entryUrl: true, ownerUserId: true, ensName: true },
});
const userById = new Map(users.map((u) => [u.id, u]));

// collision check (flat namespace: a username == an app slug share one label)
const slugs = new Set(apps.map((a) => a.slug));
for (const u of users) {
  if (slugs.has(u.username)) {
    console.warn(`⚠️  COLLISION: username "${u.username}" equals an app slug — they share one ENS label (last-writer-wins on-chain).`);
  }
}

console.log(`\n=== ${RUN ? "WRITE (RUN=1)" : "RECON (dry — set RUN=1 to write)"} ===`);

// --- one row processor (apps + users share the same flat-mint logic) ---
type Row = { kind: "app" | "user"; id: string; label: string; owner?: string | null; url?: string; ensName: string | null };

const process_ = async (r: Row) => {
  const target = `${r.label}.superjam.eth`;
  if (!r.owner) {
    console.log(`  SKIP  ${r.kind} ${r.label} — no owner wallet`);
    return;
  }
  const owner = r.owner;
  // idempotency: on-chain addr already == owner AND db ensName already target
  let onchainAddr = "0x0";
  try {
    onchainAddr = await onchain.ensV2Addr(r.label);
  } catch {
    /* read fail — treat as not-set */
  }
  const dbOk = r.ensName === target;
  const chainOk = eq2(onchainAddr, owner);
  if (dbOk && chainOk) {
    console.log(`  OK    ${r.kind} ${target} -> ${owner} (already correct)`);
    return;
  }
  console.log(
    `  MINT  ${r.kind} ${target} -> ${owner}  ${RUN ? "" : "[would mint]"}` +
      (chainOk ? "" : `  (chain addr was ${onchainAddr})`) +
      (dbOk ? "" : `  (db ensName was ${r.ensName ?? "null"})`)
  );
  if (!RUN) return;
  const minted = await onchain.mintV2Subname({
    slug: r.label,
    owner: owner as `0x${string}`,
    records: r.url ? { url: r.url } : undefined,
  });
  if (r.kind === "app") {
    await db.update(schema.app).set({ ensName: minted.ensName, ensTxHash: minted.txHash }).where(eq(schema.app.id, r.id as `app_${string}`));
  } else {
    await db.update(schema.user).set({ ensName: minted.ensName }).where(eq(schema.user.id, r.id as `usr_${string}`));
  }
  console.log(`        ✓ ${minted.ensName}  tx ${minted.txHash}`);
};

console.log(`\n-- apps (${apps.length}) --`);
for (const a of apps) {
  const owner = a.ownerUserId ? userById.get(a.ownerUserId)?.walletAddress : null;
  await process_({ kind: "app", id: a.id, label: a.slug, owner, url: a.entryUrl ?? undefined, ensName: a.ensName });
}

console.log(`\n-- users (${users.length}) --`);
for (const u of users) {
  await process_({
    kind: "user",
    id: u.id,
    label: u.username,
    owner: u.walletAddress,
    url: `https://superjam.fun/@${u.username}`,
    ensName: u.ensName,
  });
}

console.log(`\n${RUN ? "done — re-run to confirm a full no-op." : "recon only. set RUN=1 to mint."}`);
await pool.end();
