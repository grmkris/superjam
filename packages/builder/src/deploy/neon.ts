// Neon client (deploy design doc §A). One POST creates a project + default
// branch + role + database + endpoint atomically; `connection_uris` is returned
// because our branch has a single role+db. We take the pooled DSN for runtime
// (DATABASE_URL) and keep the direct DSN for build-time migrations (DDL can't
// run cleanly through PgBouncer). Org-scoped key ⇒ org_id is inferred, so every
// app-DB lands in one billing org for scoped listing/teardown.
import type { NeonClient, NeonProject } from "./types.ts";

const NEON_API = "https://console.neon.tech/api/v2";

export interface NeonClientConfig {
  apiKey: string;
  /** Co-locate the DB with the app's Vercel region (deploy doc §A.1). */
  regionId?: string;
  pgVersion?: number;
  fetchImpl?: typeof fetch;
}

interface NeonCreateResponse {
  project: { id: string };
  connection_uris?: { connection_uri: string }[];
}

/** Insert the `-pooler` suffix into a direct DSN host (deploy doc §A.2). */
const toPooled = (dsn: string): string =>
  dsn.replace(/@([^.]+)\./, "@$1-pooler.");

const withSsl = (dsn: string): string =>
  dsn.includes("sslmode=") ? dsn : `${dsn}${dsn.includes("?") ? "&" : "?"}sslmode=require`;

export const createNeonClient = (config: NeonClientConfig): NeonClient => {
  const doFetch = config.fetchImpl ?? fetch;
  const headers = {
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
  };

  return {
    async createProject(name: string): Promise<NeonProject> {
      const res = await doFetch(`${NEON_API}/projects`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project: {
            name,
            ...(config.regionId ? { region_id: config.regionId } : {}),
            pg_version: config.pgVersion ?? 17,
            default_endpoint_settings: {
              autoscaling_limit_min_cu: 0.25,
              autoscaling_limit_max_cu: 1,
            },
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`Neon create failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as NeonCreateResponse;
      const direct = body.connection_uris?.[0]?.connection_uri;
      if (!direct) {
        throw new Error("Neon response missing connection_uris");
      }
      return {
        projectId: body.project.id,
        directDsn: withSsl(direct),
        pooledDsn: withSsl(toPooled(direct)),
      };
    },

    async deleteProject(projectId: string): Promise<void> {
      const res = await doFetch(`${NEON_API}/projects/${projectId}`, {
        method: "DELETE",
        headers,
      });
      // 404 ⇒ already gone; teardown is idempotent.
      if (!res.ok && res.status !== 404) {
        throw new Error(`Neon delete failed: ${res.status}`);
      }
    },
  };
};
