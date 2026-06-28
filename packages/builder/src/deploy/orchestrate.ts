// runDeploy — the headless build pipeline (pivot §6): generate → [Neon if the
// app declares data] → deploy to Vercel → entryUrl. The deploy is the Vercel
// CLI (`vercel deploy --prod`, apps/builder/cli-deploy.ts), injected as the
// `DeployPort` so the orchestration is unit-tested without a live deploy.
// Identity (SUPERJAM_APP_ID / SUPERJAM_JWKS_URL) is BAKED into the generated
// source, so there is no env-injection step.
import type { AppSpec } from "@superjam/shared";
import type {
  DeployEvent,
  DeployPort,
  DeployResult,
  Generator,
  NeonClient,
  VercelTeardown,
} from "./types.ts";

export interface RunDeployDeps {
  generate: Generator;
  /** Ships the generated files to Vercel → public production URL. */
  deploy: DeployPort;
  /** `vercel rm <project>` — reaps a failed build's project (idempotent). */
  teardownVercel?: VercelTeardown;
  /** Required only when the generated app needs data (its own Neon project). */
  neon?: NeonClient;
  /** Platform JWKS, baked into the app's source as SUPERJAM_JWKS_URL. */
  jwksUrl: string;
  onEvent?: (e: DeployEvent) => void;
  /** Injected clock (durationMs). */
  now?: () => number;
}

export interface RunDeployArgs {
  spec: AppSpec;
  buildId: string;
  /** Pre-generated app id (JWT `aud`); also the row id at registration. */
  appId: string;
  /** DNS-safe `superjam-<appId>` project name (≤100 chars). */
  projectName: string;
}

type Emit = (kind: DeployEvent["kind"], label: string) => void;

/**
 * Run one cleanup op, swallowing + logging any failure. Returns the outcome so
 * teardown can report what leaked; the reaper ignores the return. `vercel rm`
 * and Neon delete are idempotent, so re-running is safe.
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
 * Best-effort, idempotent reap of what a failed deploy left behind. NEVER throws
 * — reap errors are swallowed so the ORIGINAL deploy error is what the caller
 * rethrows (the build feed must show the true cause, not a cleanup artifact).
 */
const reapPartial = async (
  deps: RunDeployDeps,
  ids: { vercelProject?: string; neonProjectId?: string },
  emit: Emit
): Promise<void> => {
  const vp = ids.vercelProject;
  const teardownVercel = deps.teardownVercel;
  if (vp && teardownVercel) {
    await tryDelete(`vercel ${vp}`, () => teardownVercel(vp), emit);
  }
  const nid = ids.neonProjectId;
  const neon = deps.neon;
  if (nid && neon) {
    await tryDelete(`neon ${nid}`, () => neon.deleteProject(nid), emit);
  }
};

/**
 * Generate + deploy an app. Throws on generation / provisioning / deploy failure
 * (the caller marks the build failed). On a failure after the deploy was
 * attempted, reaps the (possibly orphaned) Vercel project — and the Neon project
 * if one was created — before rethrowing, so a failed build never orphans
 * resources (Neon free tier caps at 100).
 */
export const runDeploy = async (
  args: RunDeployArgs,
  deps: RunDeployDeps
): Promise<DeployResult> => {
  const { spec, buildId, appId, projectName } = args;
  const now = deps.now ?? Date.now;
  const emit: Emit = (kind, label) => deps.onEvent?.({ t: Date.now(), kind, label });
  const started = now();

  emit("status", "generating");
  const app = await deps.generate(spec, { buildId, appId, jwksUrl: deps.jwksUrl });

  let neonProjectId: string | undefined;
  let deployAttempted = false;
  try {
    if (app.needsData) {
      if (!deps.neon) {
        throw new Error("app declares data but no Neon client is configured");
      }
      emit("status", "provisioning database");
      const project = await deps.neon.createProject(projectName);
      neonProjectId = project.projectId;
      // NOTE: the pooled DSN (project.pooledDsn) is a secret → it can't be baked
      // into source like the app id. Injecting it (`vercel env add DATABASE_URL`)
      // is a P2 follow-up; the demo path is zero-backend (no Neon).
    }

    emit("status", "deploying");
    deployAttempted = true;
    const { entryUrl } = await deps.deploy({ files: app.files, name: projectName });
    emit("status", "ready");

    return {
      entryUrl,
      manifest: app.manifest,
      vercelProject: projectName,
      neonProjectId,
      durationMs: now() - started,
    };
  } catch (err) {
    await reapPartial(
      deps,
      { vercelProject: deployAttempted ? projectName : undefined, neonProjectId },
      emit
    );
    throw err;
  }
};

// --- teardown (app delete) ---

export interface TeardownArgs {
  /** The Vercel project NAME (`vercel rm`). */
  vercelProject?: string;
  neonProjectId?: string;
}

export interface TeardownResult {
  vercel: "deleted" | "skipped" | "failed";
  neon: "deleted" | "skipped" | "failed";
}

export interface TeardownDeps {
  teardownVercel: VercelTeardown;
  neon?: NeonClient;
  onEvent?: (e: DeployEvent) => void;
}

/**
 * Idempotent, best-effort teardown of an app's external projects. Unlike the
 * reaper it does NOT throw — it returns the per-project outcome so the platform
 * can delist the app even when an external delete fails (logging what leaked for
 * a manual sweep; never block delisting on a flaky delete). A missing id ⇒
 * "skipped". Re-running is safe.
 */
export const teardownApp = async (
  args: TeardownArgs,
  deps: TeardownDeps
): Promise<TeardownResult> => {
  const emit: Emit = (kind, label) => deps.onEvent?.({ t: Date.now(), kind, label });
  const vp = args.vercelProject;
  const nid = args.neonProjectId;
  const neon = deps.neon;
  const vercel = await tryDelete(
    vp ? `vercel ${vp}` : "vercel",
    vp ? () => deps.teardownVercel(vp) : undefined,
    emit
  );
  const neonResult = await tryDelete(
    nid ? `neon ${nid}` : "neon",
    nid && neon ? () => neon.deleteProject(nid) : undefined,
    emit
  );
  return { vercel, neon: neonResult };
};

/**
 * Whether the app needs its OWN Neon project. Only `collections` (shared
 * structured docs the template schematizes into Drizzle tables) live in the
 * app's Neon DB. `counters` (leaderboards → app_counter) and `storage`
 * (per-user KV → app_storage) map to the platform's zero-backend bridge
 * (sdk.counter / sdk.storage, §9), so a counter/storage-only app provisions NO
 * Neon project — avoids burning one against the free 100-cap.
 */
export const specNeedsData = (spec: AppSpec): boolean =>
  spec.data.collections.length > 0;

// DNS-safe Vercel project name — the SINGLE source of truth for every caller
// (projectNameFor here, vercelProjectName in apps/builder/cli-deploy.ts). Vercel
// rewrites `_`/`.`→`-` and disallows other punctuation on create, so we normalize
// the same way: if we reported a name that differs from what Vercel actually made,
// the entryUrl resolver (vercel-alias.ts) would look up a 404 project and record a
// dead URL. Keeping ONE function means the two can never drift apart again.
export const sanitizeProjectName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{3,}/g, "--")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "superjam-app";

/** DNS-safe Vercel/Neon project name for an app. */
export const projectNameFor = (appId: string): string => sanitizeProjectName(`superjam-${appId}`);
