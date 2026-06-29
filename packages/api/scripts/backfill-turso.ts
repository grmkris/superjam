// One-time backfill (B1): copy each app's existing shared-Postgres data
// (appRecord/appCounter/appStorage) into its OWN per-app libSQL/Turso DB. The
// data plane reads per-app Turso now, so existing apps' collections/counters/
// storage would otherwise be orphaned. Idempotent (onConflictDoNothing) — safe to
// re-run. Run with DATABASE_URL (the platform DB) + TURSO_API_TOKEN/ORG/GROUP set.
//   DATABASE_URL=… TURSO_API_TOKEN=… TURSO_ORG=… bun packages/api/scripts/backfill-turso.ts
import { createDb, schema } from "@superjam/db";
import {
  appData,
  bindAppDb,
  createTursoClient,
  ensureAppTables,
  tursoDbNameFor,
} from "@superjam/db/libsql";
import { eq } from "drizzle-orm";

const { appRecord, appCounter, appStorage } = schema;

const { db } = createDb(process.env.DATABASE_URL!);
const turso = createTursoClient({
  apiToken: process.env.TURSO_API_TOKEN!,
  org: process.env.TURSO_ORG!,
  group: process.env.TURSO_GROUP ?? "default",
});

const recApps = await db.selectDistinct({ appId: appRecord.appId }).from(appRecord);
const cntApps = await db.selectDistinct({ appId: appCounter.appId }).from(appCounter);
const stoApps = await db.selectDistinct({ appId: appStorage.appId }).from(appStorage);
const appIds = [
  ...new Set([...recApps, ...cntApps, ...stoApps].map((r) => r.appId)),
];
console.log(`backfilling ${appIds.length} app(s) with data`);

for (const appId of appIds) {
  const name = tursoDbNameFor(appId);
  const { dbUrl } = await turso.ensureDatabase(name);
  const authToken = await turso.mintToken(name);
  const { db: adb, client } = bindAppDb({ dbUrl, authToken });
  await ensureAppTables(client);

  const recs = await db.select().from(appRecord).where(eq(appRecord.appId, appId));
  if (recs.length) {
    await adb
      .insert(appData.records)
      .values(
        recs.map((r) => ({
          id: r.id,
          collection: r.collection,
          userId: r.userId,
          username: r.username,
          worldVerified: r.worldVerified,
          data: r.data,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }))
      )
      .onConflictDoNothing();
  }

  const cnts = await db.select().from(appCounter).where(eq(appCounter.appId, appId));
  if (cnts.length) {
    await adb
      .insert(appData.counters)
      .values(
        cnts.map((c) => ({ counter: c.counter, key: c.key, value: Number(c.value) }))
      )
      .onConflictDoNothing();
  }

  const stos = await db.select().from(appStorage).where(eq(appStorage.appId, appId));
  if (stos.length) {
    await adb
      .insert(appData.storage)
      .values(
        stos.map((s) => ({
          userId: s.userId,
          key: s.key,
          value: s.value,
          updatedAt: s.updatedAt,
        }))
      )
      .onConflictDoNothing();
  }

  client.close();
  console.log(
    `  ${appId}: ${recs.length} records, ${cnts.length} counters, ${stos.length} storage → ${name}`
  );
}

console.log("backfill complete");
process.exit(0);
