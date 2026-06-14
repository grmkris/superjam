#!/usr/bin/env bun
// Lower the fleet builder prices for cheap, repeatable x402 paid testing (§14).
// Updates builder_agent.price_usdc by slug. The DB price drives the confirm-sheet
// quote, payBuildFee's amount, and the create-gate — keep it in sync with the
// builder box's AGENT_PRICE_USDC (the on-chain 402 challenge amount is the one
// that's actually charged). Idempotent.
//
//   recon (no writes):  DEV_DB_URL=… bun packages/api/scripts/set-builder-prices.ts
//   apply:              DEV_DB_URL=… RUN=1 bun packages/api/scripts/set-builder-prices.ts
import { createDb } from "@superjam/db";
import { sql } from "drizzle-orm";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL");
  process.exit(2);
}
const RUN = process.env.RUN === "1";

// slug → new price (decimal USDC string). 1¢ / 2¢ / 5¢ — only the box-configured
// agent (lite) is end-to-end testable on the single dev box; the rest are quote-only
// until they get their own x402 endpoint.
const PRICES: Record<string, string> = {
  lite: "0.01",
  standard: "0.02",
  pro: "0.05",
};

const { db, pool } = createDb(DEV_DB_URL);
try {
  for (const [slug, price] of Object.entries(PRICES)) {
    const res = (await db.execute(
      sql`select price_usdc from "builder_agent" where slug = ${slug}`
    )) as unknown as { rows: { price_usdc: string }[] };
    const row = (res.rows ?? [])[0];
    if (!row) {
      console.log(`  ? ${slug}: not in DB`);
      continue;
    }
    if (row.price_usdc === price) {
      console.log(`  ok ${slug}: already ${price}`);
      continue;
    }
    if (!RUN) {
      console.log(`  would set ${slug}: ${row.price_usdc} → ${price}  (DRY RUN)`);
      continue;
    }
    await db.execute(
      sql`update "builder_agent" set price_usdc=${price}, updated_at=now() where slug=${slug}`
    );
    console.log(`  🔧 ${slug}: ${row.price_usdc} → ${price}`);
  }
  if (!RUN) console.log("\nDRY RUN — set RUN=1 to apply.");
} finally {
  await pool.end();
}
