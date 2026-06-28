#!/usr/bin/env bun
// Mint NESTED ENSv2 names `<slug>.<owner>.superjam.eth` for the 3 builder jams
// (reflex-rush, what-if-calc, locked-notes) — like the existing demos. The owner
// (kristjangrm1) has no wallet in the DB, so we resolve their REAL wallet ON-CHAIN
// (the address `<owner>.superjam.eth` resolves to) and mint owned by it. Sequential
// (one process, viem serializes nonce) — never run ENS writes in parallel.
//
//   recon:  DEV_DB_URL=… ENS_V2_REGISTRY=… ENS_V2_SIGNER_KEY=… SEPOLIA_RPC_URL=… bun packages/api/scripts/mint-jam-ens.ts
//   write:  … RUN=1 [SLUGS=reflex-rush,…] bun packages/api/scripts/mint-jam-ens.ts
import { createDb, schema } from "@superjam/db";
import { type Onchain, createOnchainFromConfig, nullOnchain } from "@superjam/onchain";
import { inArray } from "drizzle-orm";
import { eq } from "drizzle-orm";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) { console.error("set DEV_DB_URL"); process.exit(2); }
const RUN = process.env.RUN === "1";
const OWNER = process.env.OWNER ?? "kristjangrm1";
const SLUGS = (process.env.SLUGS?.split(",") ?? ["reflex-rush", "what-if-calc", "locked-notes"])
  .map((s) => s.trim()).filter(Boolean);
const ZERO = "0x0000000000000000000000000000000000000000";

const onchain: Onchain =
  createOnchainFromConfig({
    // createOnchainFromConfig returns null without an Arc server-wallet key
    // (the guard). We don't touch Arc here — ENS writes use ensV2SignerKey — so
    // reuse that key just to satisfy the guard (the Arc wallet is built unused).
    serverWalletPrivateKey:
      process.env.SERVER_WALLET_PRIVATE_KEY || process.env.ENS_V2_SIGNER_KEY,
    baseRpcUrl: process.env.BASE_RPC_URL,
    ensV2: process.env.ENS_V2_REGISTRY
      ? { registry: process.env.ENS_V2_REGISTRY as `0x${string}` }
      : undefined,
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL,
    ensV2SignerKey: process.env.ENS_V2_SIGNER_KEY,
  }) ?? nullOnchain;
if (onchain === nullOnchain) {
  console.error("onchain is NULL — set ENS_V2_REGISTRY / ENS_V2_SIGNER_KEY / SEPOLIA_RPC_URL");
  process.exit(2);
}

const { db, pool } = createDb(DEV_DB_URL);
try {
  // Resolve the owner's real wallet on-chain (what <owner>.superjam.eth points to).
  let ownerWallet = ZERO;
  try {
    ownerWallet = await onchain.ensV2Addr(OWNER);
  } catch (e) {
    console.error(`failed to resolve ${OWNER}.superjam.eth on-chain: ${String(e).slice(0, 120)}`);
  }
  console.log(`owner ${OWNER}.superjam.eth → ${ownerWallet}`);
  if (!ownerWallet || ownerWallet.toLowerCase() === ZERO) {
    console.error(`could not resolve ${OWNER}'s wallet on-chain — aborting (no owner for the subnames)`);
    process.exit(1);
  }

  const apps = await db.query.app.findMany({
    columns: { id: true, slug: true, entryUrl: true, ensName: true },
    where: inArray(schema.app.slug, SLUGS),
  });
  console.log(`\n=== ${RUN ? "WRITE (RUN=1)" : "RECON (dry)"} — ${apps.length} app(s) ===`);

  for (const a of apps) {
    const target = `${a.slug}.${OWNER}.superjam.eth`;
    if (a.ensName === target) { console.log(`  OK   ${a.slug} already ${target}`); continue; }
    console.log(`  MINT ${a.slug} → ${target}  owner=${ownerWallet}${RUN ? "" : "  [would mint]"}`);
    if (!RUN) continue;
    const minted = await onchain.mintV2Subname({
      slug: a.slug,
      owner: ownerWallet as `0x${string}`,
      under: OWNER, // nested: <slug>.<OWNER>.superjam.eth (ENSIP-10 wildcard)
      records: a.entryUrl ? { url: a.entryUrl } : undefined,
    });
    await db
      .update(schema.app)
      .set({ ensName: minted.ensName, ensTxHash: minted.txHash })
      .where(eq(schema.app.id, a.id));
    console.log(`       ✓ ${minted.ensName}  tx ${minted.txHash}`);
  }
  console.log(`\n${RUN ? "done." : "recon only — set RUN=1 to mint."}`);
} finally {
  await pool.end();
}
