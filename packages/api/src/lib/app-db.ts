// Per-app data plane resolution (agent-native runtime, B1). Each app's data
// (sdk.data.collection/counter/storage) lives in its OWN libSQL/Turso database,
// named deterministically from its appId (no creds stored platform-side). resolve()
// ensures the DB exists + mints a token + ensures the tables on first use, binds a
// Drizzle client, and caches it. The bridge services run against the returned ctx.db.
import {
  type AppDb,
  type TursoClient,
  bindAppDb,
  ensureAppTables,
  tursoDbNameFor,
} from "@superjam/db/libsql";
import { ORPCError } from "@orpc/server";

export interface AppDataProvider {
  /** Resolve the app's per-app DB — provisions on first use, then cached. */
  resolve(appId: string): Promise<AppDb>;
}

export interface AppDataProviderDeps {
  turso: TursoClient;
  /** Max cached per-app DB handles (insertion-ordered LRU). */
  cacheMax?: number;
}

export const createAppDataProvider = (
  deps: AppDataProviderDeps
): AppDataProvider => {
  const cacheMax = deps.cacheMax ?? 256;
  const cache = new Map<string, AppDb>();

  return {
    async resolve(appId: string): Promise<AppDb> {
      const cached = cache.get(appId);
      if (cached) return cached;

      const name = tursoDbNameFor(appId);
      const { dbUrl } = await deps.turso.ensureDatabase(name);
      const authToken = await deps.turso.mintToken(name);
      const { db, client } = bindAppDb({ dbUrl, authToken });
      await ensureAppTables(client); // idempotent — covers provision + cold bind

      if (cache.size >= cacheMax) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(appId, db);
      return db;
    },
  };
};

/** Default provider when `TURSO_*` env is absent — data ops reject cleanly so
 *  boot/tests stay green without provisioning configured. */
export const nullAppDataProvider: AppDataProvider = {
  resolve() {
    return Promise.reject(
      new ORPCError("INTERNAL", { message: "per-app data plane not configured" })
    );
  },
};
