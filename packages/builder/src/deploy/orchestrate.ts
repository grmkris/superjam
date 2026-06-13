// runDeploy — the headless build pipeline (deploy design doc §0): generate →
// [Neon if needed] → Vercel (env BEFORE deploy) → poll READY → entryUrl. Pure
// orchestration over the ports in types.ts; both external services are stubbed
// in tests. Speed (deploy doc §E): the generator emits a PREBUILT tree so the
// remote Next build (the 60-120s long pole) is skipped — the client ships
// `.vercel/output` and Vercel only uploads + activates.
import type { AppSpec } from "@superjam/shared";
import type {
  DeployEvent,
  DeployResult,
  Generator,
  NeonClient,
  VercelClient,
  VercelEnvVar,
} from "./types.ts";

export interface RunDeployDeps {
  generate: Generator;
  vercel: VercelClient;
  /** Required only when the generated app needs data. */
  neon?: NeonClient;
  /** Public JWKS URL injected as SUPERJAM_JWKS_URL (deploy doc §B.2). */
  jwksUrl: string;
  onEvent?: (e: DeployEvent) => void;
  /** Injected clock + sleep so tests don't wait on the poll loop. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Poll budget for the deployment to reach READY. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface RunDeployArgs {
  spec: AppSpec;
  buildId: string;
  /** Pre-generated app id (JWT `aud`); also the row id at registration. */
  appId: string;
  /** DNS-safe `superjam-<appId>` project name (≤100 chars, deploy doc §C). */
  projectName: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

type Emit = (kind: DeployEvent["kind"], label: string) => void;

/**
 * Delete one project, swallowing + logging any failure. Returns the outcome so
 * teardown (Phase 3) can report what leaked; the reaper ignores the return.
 * Both clients' deleteProject already swallow 404, so re-running is safe.
 */
export const tryDelete = async (
  label: string,
  del: (() => Promise<void>) | undefined,
  emit: Emit
): Promise<"deleted" | "skipped" | "failed"> => {
  if (!del) return "skipped";
  try {
    await del();
    return "deleted";
  } catch (e) {
    emit("error", `${label} delete failed: ${String(e)}`);
    return "failed";
  }
};

/**
 * Best-effort, idempotent reap of the projects a failed deploy half-created.
 * NEVER throws — reap errors are swallowed so the ORIGINAL deploy error is what
 * the caller rethrows (the build feed must show the true cause, not a cleanup
 * artifact). Reaps by id (held in runDeploy's scope), not by name.
 */
const reapPartial = async (
  deps: RunDeployDeps,
  ids: { vercelProjectId?: string; neonProjectId?: string },
  emit: Emit
): Promise<void> => {
  const vid = ids.vercelProjectId;
  if (vid) {
    await tryDelete(`vercel ${vid}`, () => deps.vercel.deleteProject(vid), emit);
  }
  const nid = ids.neonProjectId;
  const neon = deps.neon;
  if (nid && neon) {
    await tryDelete(`neon ${nid}`, () => neon.deleteProject(nid), emit);
  }
};

/**
 * Provision + deploy an app. Throws on generation / provisioning / deploy
 * failure (the caller marks the build failed). On a partial failure AFTER a
 * Vercel/Neon project was created, reaps it (by id) before rethrowing — so a
 * failed build never orphans a project (Neon free tier caps at 100, deploy doc
 * §A.4). A generation failure created nothing, so it skips the reap.
 */
export const runDeploy = async (
  args: RunDeployArgs,
  deps: RunDeployDeps
): Promise<DeployResult> => {
  const { spec, buildId, appId, projectName } = args;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const emit: Emit = (kind, label) => deps.onEvent?.({ kind, label });
  const started = now();

  emit("status", "generating");
  const app = await deps.generate(spec, { buildId, appId });

  // Tracked across the try so the catch can reap whatever got created.
  let neonProjectId: string | undefined;
  let vercelProjectId: string | undefined;
  try {
    let databaseUrl: string | undefined;
    if (app.needsData) {
      if (!deps.neon) {
        throw new Error("app declares data but no Neon client is configured");
      }
      emit("status", "provisioning database");
      const project = await deps.neon.createProject(projectName);
      neonProjectId = project.projectId;
      databaseUrl = project.pooledDsn;
    }

    emit("status", "creating project");
    const created = await deps.vercel.createProject(projectName);
    vercelProjectId = created.projectId;
    const vid = created.projectId;

    // Env is baked at build time → set BEFORE deploy. Only the app's own
    // DATABASE_URL is a secret; the SuperJam vars are public.
    const env: VercelEnvVar[] = [
      { key: "SUPERJAM_APP_ID", value: appId, type: "plain" },
      { key: "SUPERJAM_JWKS_URL", value: deps.jwksUrl, type: "plain" },
    ];
    if (databaseUrl) {
      env.push({ key: "DATABASE_URL", value: databaseUrl, type: "encrypted" });
    }
    emit("status", "setting env");
    await deps.vercel.setEnv(vid, env);

    emit("status", "deploying");
    const deployment = await deps.vercel.deploy({
      projectId: vid,
      name: projectName,
      files: app.files,
      prebuilt: app.prebuilt,
    });

    await pollUntilReady(deployment.deploymentId, deps, sleep, now, emit);

    const entryUrl = deps.vercel.productionUrl(vid, projectName);
    emit("status", "ready");

    return {
      entryUrl,
      manifest: app.manifest,
      vercelProjectId: vid,
      neonProjectId,
      durationMs: now() - started,
    };
  } catch (err) {
    await reapPartial(deps, { vercelProjectId, neonProjectId }, emit);
    throw err;
  }
};

// --- teardown (app delete) ---

export interface TeardownArgs {
  vercelProjectId?: string;
  neonProjectId?: string;
}

export interface TeardownResult {
  vercel: "deleted" | "skipped" | "failed";
  neon: "deleted" | "skipped" | "failed";
}

export interface TeardownDeps {
  vercel: VercelClient;
  neon?: NeonClient;
  onEvent?: (e: DeployEvent) => void;
}

/**
 * Idempotent, best-effort teardown of an app's external projects. Unlike the
 * reaper it does NOT throw — it returns the per-project outcome so the platform
 * can delist the app even when an external delete fails (logging what leaked for
 * a manual sweep; never block delisting on a flaky delete). A missing id ⇒
 * "skipped". Re-running is safe (clients swallow 404).
 */
export const teardownApp = async (
  args: TeardownArgs,
  deps: TeardownDeps
): Promise<TeardownResult> => {
  const emit: Emit = (kind, label) => deps.onEvent?.({ kind, label });
  const vid = args.vercelProjectId;
  const nid = args.neonProjectId;
  const neon = deps.neon;
  const vercel = await tryDelete(
    vid ? `vercel ${vid}` : "vercel",
    vid ? () => deps.vercel.deleteProject(vid) : undefined,
    emit
  );
  const neonResult = await tryDelete(
    nid ? `neon ${nid}` : "neon",
    nid && neon ? () => neon.deleteProject(nid) : undefined,
    emit
  );
  return { vercel, neon: neonResult };
};

const pollUntilReady = async (
  deploymentId: string,
  deps: RunDeployDeps,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  emit: (kind: DeployEvent["kind"], label: string) => void
): Promise<void> => {
  const interval = deps.pollIntervalMs ?? 2000;
  const timeout = deps.pollTimeoutMs ?? 180_000;
  const deadline = now() + timeout;

  for (;;) {
    const d = await deps.vercel.getDeployment(deploymentId);
    if (d.readyState === "READY") return;
    if (d.readyState === "ERROR" || d.readyState === "CANCELED") {
      emit("error", `deployment ${d.readyState.toLowerCase()}`);
      throw new Error(`Vercel deployment ${d.readyState}`);
    }
    if (now() >= deadline) {
      throw new Error("Vercel deployment timed out");
    }
    await sleep(interval);
  }
};

/**
 * Whether the app needs its OWN Neon project. Only `collections` (shared
 * structured docs the template schematizes into Drizzle tables) live in the
 * app's Neon DB. `counters` (leaderboards → app_counter) and `storage`
 * (per-user KV → app_storage) map to the platform's zero-backend bridge
 * (sdk.counter / sdk.storage, §9), so a counter/storage-only app provisions NO
 * Neon project — avoids burning one against the free 100-cap (deploy doc §A.4).
 */
export const specNeedsData = (spec: AppSpec): boolean =>
  spec.data.collections.length > 0;

/** DNS-safe Vercel/Neon project name, ≤100 chars (deploy doc §C). */
export const projectNameFor = (appId: string): string =>
  `superjam-${appId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 100);
