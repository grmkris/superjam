// Remote build dispatch (§11, BUILDER_MODE=remote). The deployed platform ships
// no Claude CLI / Vercel creds: runBuild dispatches the AppSpec to a registered
// builder agent's endpoint (our apps/builder is pre-seeded row #1) and polls for
// the deploy result. The builder DEPLOYS and returns an entryUrl (pivot §6) —
// not bundles. A `BuildDeployer` is the seam the build driver depends on; tests
// inject a stub so no live builder is needed.
import type { DeployResult } from "@superjam/builder/deploy";
import type { AppSpec } from "@superjam/shared";

export interface DeployRequest {
  spec: AppSpec;
  buildId: string;
  /** Pre-generated app id → SUPERJAM_APP_ID (JWT aud), injected before deploy. */
  appId: string;
}

export type BuildDeployer = (req: DeployRequest) => Promise<DeployResult>;

/** Narrow fetch shape — avoids depending on the global `fetch`'s extra props. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface RemoteDeployerConfig {
  url: string;
  token: string;
  pollMs?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

interface BuilderStatus {
  status: "running" | "done" | "failed";
  result?: DeployResult;
  error?: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Dispatch to a builder endpoint over the public protocol and poll to done. */
export const createRemoteDeployer = (
  cfg: RemoteDeployerConfig
): BuildDeployer => {
  const doFetch = cfg.fetchImpl ?? fetch;
  const sleep = cfg.sleep ?? defaultSleep;
  const base = cfg.url.replace(/\/$/, "");
  const headers = {
    authorization: `Bearer ${cfg.token}`,
    "content-type": "application/json",
  };

  return async ({ spec, buildId, appId }) => {
    const accept = await doFetch(`${base}/builds`, {
      method: "POST",
      headers,
      body: JSON.stringify({ spec, buildId, appId }),
    });
    if (accept.status === 429) {
      // Builder busy — surface so the platform FIFO holds + retries.
      throw new Error("BUILDER_BUSY");
    }
    if (!accept.ok) {
      throw new Error(`builder rejected build: ${accept.status}`);
    }

    const interval = cfg.pollMs ?? 1500;
    const deadline = Date.now() + (cfg.timeoutMs ?? 240_000);
    for (;;) {
      await sleep(interval);
      const res = await doFetch(`${base}/builds/${buildId}`, { headers });
      if (!res.ok) {
        if (Date.now() >= deadline) throw new Error("builder poll timed out");
        continue;
      }
      const body = (await res.json()) as BuilderStatus;
      if (body.status === "done" && body.result) return body.result;
      if (body.status === "failed") {
        throw new Error(body.error ?? "build failed");
      }
      if (Date.now() >= deadline) throw new Error("builder build timed out");
    }
  };
};
