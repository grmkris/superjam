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

// --- Turso provisioning (Platform API) — every app gets its own SQLite DB ---

const TURSO_API = "https://api.turso.tech/v1";

export interface TursoClient {
  /** Create the DB if missing (idempotent — 409 ⇒ fetch existing); returns its
   *  `libsql://…` URL. No creds are stored platform-side; the name is derived from
   *  the appId, so this + mintToken fully resolve an app's DB. */
  ensureDatabase(name: string): Promise<{ dbUrl: string }>;
  /** Mint a fresh DB-scoped auth token (cached in memory by the caller). */
  mintToken(name: string): Promise<string>;
  /** Idempotent teardown (orphan GC / app delete). */
  deleteDatabase(name: string): Promise<void>;
}

export interface TursoClientConfig {
  apiToken: string;
  /** Org slug — every app-DB lands here for scoped listing/teardown. */
  org: string;
  /** DB group (region). Defaults to "default". */
  group?: string;
  fetchImpl?: typeof fetch;
}

interface TursoCreateResponse {
  database?: { Hostname?: string; Name?: string };
}

/** Provisioning client — verified against api.turso.tech (create → token → delete). */
export const createTursoClient = (config: TursoClientConfig): TursoClient => {
  const doFetch = config.fetchImpl ?? fetch;
  const group = config.group ?? "default";
  const headers = {
    authorization: `Bearer ${config.apiToken}`,
    "content-type": "application/json",
  };
  const base = `${TURSO_API}/organizations/${config.org}/databases`;

  const hostnameOf = async (res: Response): Promise<string> => {
    const body = (await res.json()) as TursoCreateResponse;
    const hostname = body.database?.Hostname;
    if (!hostname) {
      throw new Error("Turso response missing database.Hostname");
    }
    return hostname;
  };

  return {
    async ensureDatabase(name: string): Promise<{ dbUrl: string }> {
      const res = await doFetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, group }),
      });
      if (res.ok) {
        return { dbUrl: `libsql://${await hostnameOf(res)}` };
      }
      if (res.status === 409) {
        // Already exists — fetch its hostname.
        const get = await doFetch(`${base}/${name}`, { headers });
        if (!get.ok) {
          throw new Error(`Turso get failed: ${get.status} ${await get.text()}`);
        }
        return { dbUrl: `libsql://${await hostnameOf(get)}` };
      }
      throw new Error(`Turso create failed: ${res.status} ${await res.text()}`);
    },

    async mintToken(name: string): Promise<string> {
      const res = await doFetch(`${base}/${name}/auth/tokens`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        throw new Error(`Turso token mint failed: ${res.status} ${await res.text()}`);
      }
      const tok = (await res.json()) as { jwt?: string };
      if (!tok.jwt) {
        throw new Error("Turso token response missing jwt");
      }
      return tok.jwt;
    },

    async deleteDatabase(name: string): Promise<void> {
      const res = await doFetch(`${base}/${name}`, { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Turso delete failed: ${res.status}`);
      }
    },
  };
};

/** Turso DB name for an app — DNS-safe, lowercased, bounded. */
export const tursoDbNameFor = (appId: string): string =>
  `sj-${appId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58) || "sj-app";

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
