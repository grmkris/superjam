// In-memory Postgres for tests (pglite). Each call = a fresh, isolated db with
// the full migration set applied — DI'd into services, never module-mocked
// (house pattern, sonara/appmisha test-utils).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Database } from "./index.ts";
import * as schema from "./schema/index.ts";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations"
);

// The pglite drizzle instance is API-compatible with the node-postgres one for
// every query/insert/update we use, so we surface it as the same `Database`
// type — services are DI'd one db type, never branched per driver.
export const createPgliteDb = async (): Promise<{
  db: Database;
  client: PGlite;
}> => {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Database, client };
};
