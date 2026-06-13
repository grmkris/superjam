#!/usr/bin/env bun
// Fix entry_url for builder-deployed jams whose recorded URL is the builder's
// GUESS `https://superjam-<appId>.vercel.app`. Vercel TRUNCATES long auto-aliases,
// so that guess 404s; the real public production alias is shorter. We resolve the
// actual alias from Vercel and update entry_url/entry_origin.
//
//   DEV_DB_URL=… bun packages/api/scripts/fix-builder-urls.ts [slug,slug,…]   (default: all 3 new jams)
import { createDb } from "@superjam/db";
import { typeIdFromUuid } from "@superjam/shared/typeid";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) { console.error("set DEV_DB_URL"); process.exit(2); }

const SLUGS = (process.argv[2]?.split(",") ?? ["what-if-calc", "locked-notes", "reflex-rush"])
  .map((s) => s.trim()).filter(Boolean);

const vercelToken = (): string => {
  const p = join(homedir(), ".local/share/com.vercel.cli/auth.json");
  return JSON.parse(readFileSync(p, "utf8")).token as string;
};

/** The clean PUBLIC production alias (no `-projects` scope suffix), shortest first. */
const resolveAlias = async (project: string, token: string): Promise<string | null> => {
  const res = await fetch(`https://api.vercel.com/v9/projects/${project}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const d = (await res.json()) as {
    targets?: { production?: { alias?: string[]; url?: string } };
  };
  const prod = d.targets?.production;
  const aliases = (prod?.alias ?? []).filter(
    (a) => a.endsWith(".vercel.app") && !a.includes("-projects.")
  );
  aliases.sort((a, b) => a.length - b.length);
  return aliases[0] ?? (prod?.url ? `${prod.url}` : null);
};

const { db, pool } = createDb(DEV_DB_URL);
const token = vercelToken();
try {
  for (const slug of SLUGS) {
    const res = (await db.execute(
      sql`select id::text as uuid, entry_url from "app" where slug = ${slug}`
    )) as unknown as { rows: { uuid: string; entry_url: string | null }[] };
    const row = (res.rows ?? [])[0];
    if (!row) { console.log(`  ? ${slug}: not in DB`); continue; }
    // uuid → TypeID → builder's Vercel project name `superjam-<appId>`.
    const tid = typeIdFromUuid("app", row.uuid);
    const project = `superjam-${tid}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);
    const alias = await resolveAlias(project, token);
    if (!alias) { console.log(`  ? ${slug}: no Vercel alias for ${project}`); continue; }
    const url = `https://${alias}`;
    const origin = new URL(url).origin;
    if (url === row.entry_url) { console.log(`  ok ${slug}: already ${url}`); continue; }
    await db.execute(
      sql`update "app" set entry_url=${url}, entry_origin=${origin}, updated_at=now() where slug=${slug}`
    );
    console.log(`  🔧 ${slug}: ${row.entry_url ?? "(none)"} → ${url}`);
  }
} finally {
  await pool.end();
}
