// Remote build dispatch (§11, BUILDER_MODE=remote). The deployed platform ships
// no Claude CLI / Vercel creds: runBuild dispatches the AppSpec to a registered
// builder agent's endpoint (our apps/builder is pre-seeded row #1) and polls for
// the deploy result. The builder DEPLOYS and returns an entryUrl (pivot §6) —
// not bundles. A `BuildDeployer` is the seam the build driver depends on; tests
// inject a stub so no live builder is needed.
import type {
  DeployEvent,
  DeployResult,
  TeardownArgs,
  TeardownResult,
} from "@superjam/builder/deploy";
import type { AppSpec } from "@superjam/shared";

export interface DeployRequest {
  spec: AppSpec;
  buildId: string;
  /** Pre-generated app id → SUPERJAM_APP_ID (JWT aud), injected before deploy. */
  appId: string;
  /** The routed agent's coding model (Opus vs Sonnet) — the builder forwards it to
   *  its agent (`runAgentBuild` already accepts `model`). Absent ⇒ builder default. */
  model?: string | null;
  /** Presigned GET URLs for user-attached reference files (images/CSV/Excel/PDF).
   *  Time-limited + public so the off-box builder agent can fetch them (§17). */
  attachmentUrls?: string[];
  /** Called on each poll with the builder's latest step events, so the caller can
   *  persist them to build.events (live timeline + history). In-process only —
   *  NOT serialized to the builder (the POST body picks data fields explicitly). */
  onProgress?: (events: DeployEvent[]) => void;
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
  /** The builder's step timeline so far (mirrored into build.events). */
  events?: DeployEvent[];
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

  return async ({ spec, buildId, appId, model, attachmentUrls, onProgress }) => {
    const accept = await doFetch(`${base}/builds`, {
      method: "POST",
      headers,
      body: JSON.stringify({ spec, buildId, appId, model, attachmentUrls }),
    });
    if (accept.status === 429) {
      // Builder busy — surface so the platform FIFO holds + retries.
      throw new Error("BUILDER_BUSY");
    }
    if (!accept.ok) {
      throw new Error(`builder rejected build: ${accept.status}`);
    }

    const interval = cfg.pollMs ?? 1500;
    // 24h: a real build is an agent run + npm install + next build + vercel deploy
    // (+ Neon for data apps), and rich apps (3D / map / art) or concurrent builds on
    // a shared box can run long — we'd rather let a build finish than kill it early.
    // The builder has no internal cap, so this platform deadline is the only ceiling;
    // kept generous (effectively "don't time out") but finite so a genuinely hung
    // poll still clears the build instead of looping forever (no stale-build reaper
    // yet). To fully disable, pass timeoutMs: Infinity.
    const deadline = Date.now() + (cfg.timeoutMs ?? 86_400_000);
    for (;;) {
      await sleep(interval);
      const res = await doFetch(`${base}/builds/${buildId}`, { headers });
      if (!res.ok) {
        if (Date.now() >= deadline) throw new Error("builder poll timed out");
        continue;
      }
      const body = (await res.json()) as BuilderStatus;
      // Mirror the builder's step timeline into the caller (→ build.events) so the
      // live workshop + history read real progress from the DB.
      if (body.events?.length) onProgress?.(body.events);
      if (body.status === "done" && body.result) return body.result;
      if (body.status === "failed") {
        throw new Error(body.error ?? "build failed");
      }
      if (Date.now() >= deadline) throw new Error("builder build timed out");
    }
  };
};

/**
 * Tear down an app's external projects via the builder (which holds the operator
 * creds). One synchronous POST /teardown, no poll loop — the builder runs two
 * idempotent DELETEs and returns the per-project outcome. The caller (a delist
 * flow) should delist the app even on a "failed" outcome and log what leaked.
 */
export type AppTeardowner = (req: TeardownArgs) => Promise<TeardownResult>;

export const createRemoteTeardowner = (cfg: {
  url: string;
  token: string;
  fetchImpl?: FetchLike;
}): AppTeardowner => {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.url.replace(/\/$/, "");
  return async (req) => {
    const res = await doFetch(`${base}/teardown`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`builder teardown failed: ${res.status}`);
    }
    return (await res.json()) as TeardownResult;
  };
};
