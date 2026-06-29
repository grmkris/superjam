// Per-app libSQL/Turso binding for the agent-native runtime. The platform runtime
// resolves an app's {dbUrl, authToken} (from the app row), binds a Drizzle client
// here, and hands it to the bridge data/counter/storage services as the app's
// ctx.db. ensureAppTables creates the fixed v0 per-app schema on first use
// (drizzle-kit is NOT run per-app — these three tables are stable).
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as appData from "./schema/app-data.sqlite.ts";

export { appData };

export interface AppDbCreds {
  /** `libsql://…` (or `file:`/`:memory:` in tests). */
  dbUrl: string;
  authToken?: string;
}

export interface BoundAppDb {
  db: ReturnType<typeof drizzle<typeof appData>>;
  client: Client;
}

/** The app's typed Drizzle libSQL handle — the bridge services' `ctx.db`. */
export type AppDb = BoundAppDb["db"];

export const bindAppDb = (creds: AppDbCreds): BoundAppDb => {
  const client = createClient({ url: creds.dbUrl, authToken: creds.authToken });
  const db = drizzle(client, { schema: appData });
  return { db, client };
};

// Idempotent DDL — mirrors schema/app-data.sqlite.ts. Run once when a per-app DB
// is first bound (provision time / first data op).
export const ensureAppTables = async (client: Client): Promise<void> => {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        world_verified INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS records_collection_created ON records (collection, created_at)`,
      `CREATE TABLE IF NOT EXISTS counters (
        counter TEXT NOT NULL,
        key TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (counter, key)
      )`,
      `CREATE INDEX IF NOT EXISTS counters_top ON counters (counter, value)`,
      `CREATE TABLE IF NOT EXISTS storage (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER,
        PRIMARY KEY (user_id, key)
      )`,
    ],
    "write"
  );
};
