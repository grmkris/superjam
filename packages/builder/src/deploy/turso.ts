// Turso client — per-app SQLite for the agent-native runtime (replaces Neon).
// One POST creates a database in the org's group; a second mints a DB-scoped auth
// token. The platform stores {dbUrl, authToken} on the app row and binds a Drizzle
// libSQL client as the app's ctx.db — the deployed app never sees these creds.
// Verified against api.turso.tech: create → {database:{Hostname}}, token → {jwt}.
import type { TursoClient, TursoDatabase } from "./types.ts";

const TURSO_API = "https://api.turso.tech/v1";

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

interface TursoTokenResponse {
  jwt?: string;
}

export const createTursoClient = (config: TursoClientConfig): TursoClient => {
  const doFetch = config.fetchImpl ?? fetch;
  const group = config.group ?? "default";
  const headers = {
    authorization: `Bearer ${config.apiToken}`,
    "content-type": "application/json",
  };
  const base = `${TURSO_API}/organizations/${config.org}/databases`;

  return {
    async createDatabase(name: string): Promise<TursoDatabase> {
      const res = await doFetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, group }),
      });
      if (!res.ok) {
        throw new Error(`Turso create failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as TursoCreateResponse;
      const hostname = body.database?.Hostname;
      if (!hostname) {
        throw new Error("Turso create response missing database.Hostname");
      }
      // Mint a DB-scoped auth token (the create call does not return one).
      const tokRes = await doFetch(`${base}/${name}/auth/tokens`, {
        method: "POST",
        headers,
      });
      if (!tokRes.ok) {
        throw new Error(
          `Turso token mint failed: ${tokRes.status} ${await tokRes.text()}`
        );
      }
      const tok = (await tokRes.json()) as TursoTokenResponse;
      if (!tok.jwt) {
        throw new Error("Turso token response missing jwt");
      }
      return { name, dbUrl: `libsql://${hostname}`, authToken: tok.jwt };
    },

    async deleteDatabase(name: string): Promise<void> {
      const res = await doFetch(`${base}/${name}`, {
        method: "DELETE",
        headers,
      });
      // 404 ⇒ already gone; teardown is idempotent.
      if (!res.ok && res.status !== 404) {
        throw new Error(`Turso delete failed: ${res.status}`);
      }
    },
  };
};

// Turso DB names: lowercase alphanumeric + hyphens, ≤ a conservative bound. Mirror
// the Vercel/Neon project-name sanitizer so one app maps to one stable DB name.
export const tursoDbNameFor = (appId: string): string =>
  `sj-${appId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58) || "sj-app";
