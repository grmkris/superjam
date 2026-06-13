// Runtime db client (node-postgres) + migration runner. Tests use the pglite
// variant (./pglite). Migrations run on server boot (§7/§18).
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

export * as schema from "./schema/index.ts";
export type Database = NodePgDatabase<typeof schema>;

export const createDb = (connectionString: string): { db: Database; pool: Pool } => {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
};

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations"
);

export const runMigrations = async (db: Database): Promise<void> => {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
};
