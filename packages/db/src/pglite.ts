// In-memory Postgres for tests (pglite). Each call = a fresh, isolated db with
// the full migration set applied — DI'd into services, never module-mocked
// (house pattern, sonara/appmisha test-utils).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as schema from "./schema/index.ts";

export type PgliteDb = PgliteDatabase<typeof schema>;

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations"
);

export const createPgliteDb = async (): Promise<{
  db: PgliteDb;
  client: PGlite;
}> => {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, client };
};
