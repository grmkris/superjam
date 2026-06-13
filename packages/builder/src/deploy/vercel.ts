// Vercel client (deploy design doc §B) — pure REST, no CLI, no git, no local
// state. Sequence: create project → upload each file by sha1 digest (deduped) →
// upsert env (before deploy; env is baked at build time) → create the
// production deployment referencing the uploaded files → caller polls until
// READY. Prebuilt deploys (`prebuilt: true`, a `.vercel/output` tree) skip the
// remote build — the single biggest speed win (deploy doc §E).
import { createHash } from "node:crypto";
import type { VercelClient, VercelDeployment, VercelEnvVar } from "./types.ts";

const VERCEL_API = "https://api.vercel.com";

export interface VercelClientConfig {
  token: string;
  teamId?: string;
  fetchImpl?: typeof fetch;
}

const sha1 = (data: string): string =>
  createHash("sha1").update(data, "utf8").digest("hex");

export const createVercelClient = (config: VercelClientConfig): VercelClient => {
  const doFetch = config.fetchImpl ?? fetch;
  const team = config.teamId ? `teamId=${encodeURIComponent(config.teamId)}` : "";
  const qs = (extra = ""): string => {
    const parts = [team, extra].filter(Boolean);
    return parts.length ? `?${parts.join("&")}` : "";
  };
  const authJson = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
  };

  const api = async (path: string, init: RequestInit): Promise<Response> => {
    const res = await doFetch(`${VERCEL_API}${path}`, init);
    if (!res.ok) {
      throw new Error(`Vercel ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  };

  return {
    async createProject(name: string): Promise<{ projectId: string }> {
      const res = await api(`/v11/projects${qs()}`, {
        method: "POST",
        headers: authJson,
        body: JSON.stringify({ name, framework: "nextjs" }),
      });
      const body = (await res.json()) as { id: string };
      return { projectId: body.id };
    },

    async setEnv(projectId: string, vars: VercelEnvVar[]): Promise<void> {
      await api(`/v10/projects/${projectId}/env${qs("upsert=true")}`, {
        method: "POST",
        headers: authJson,
        body: JSON.stringify(
          vars.map((v) => ({
            key: v.key,
            value: v.value,
            type: v.type,
            target: ["production", "preview"],
          }))
        ),
      });
    },

    async deploy(args): Promise<VercelDeployment> {
      // 1) upload each file content-addressed; Vercel dedupes by digest.
      const refs = await Promise.all(
        Object.entries(args.files).map(async ([path, content]) => {
          const digest = sha1(content);
          const bytes = Buffer.byteLength(content, "utf8");
          await api(`/v2/files${qs()}`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.token}`,
              "content-length": String(bytes),
              "x-vercel-digest": digest,
            },
            body: content,
          });
          return { file: path, sha: digest, size: bytes };
        })
      );

      // 2) create the production deployment from the uploaded refs.
      const res = await api(
        `/v13/deployments${qs("skipAutoDetectionConfirmation=1")}`,
        {
          method: "POST",
          headers: authJson,
          body: JSON.stringify({
            name: args.name,
            project: args.projectId,
            target: "production",
            files: refs,
            projectSettings: { framework: "nextjs" },
            ...(args.prebuilt ? { meta: { prebuilt: "1" } } : {}),
          }),
        }
      );
      const body = (await res.json()) as {
        id: string;
        url: string;
        readyState: VercelDeployment["readyState"];
      };
      return {
        deploymentId: body.id,
        url: body.url,
        readyState: body.readyState ?? "QUEUED",
      };
    },

    async getDeployment(deploymentId: string): Promise<VercelDeployment> {
      const res = await api(`/v13/deployments/${deploymentId}${qs()}`, {
        method: "GET",
        headers: { authorization: `Bearer ${config.token}` },
      });
      const body = (await res.json()) as {
        id: string;
        url: string;
        readyState: VercelDeployment["readyState"];
        status?: VercelDeployment["readyState"];
      };
      return {
        deploymentId: body.id,
        url: body.url,
        readyState: body.readyState ?? body.status ?? "QUEUED",
      };
    },

    productionUrl(_projectId: string, name: string): string {
      return `https://${name}.vercel.app`;
    },

    async deleteProject(projectId: string): Promise<void> {
      const res = await doFetch(
        `${VERCEL_API}/v9/projects/${projectId}${qs()}`,
        { method: "DELETE", headers: { authorization: `Bearer ${config.token}` } }
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`Vercel delete failed: ${res.status}`);
      }
    },
  };
};
