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

/**
 * Provision + deploy an app. Throws on generation / provisioning / deploy
 * failure (the caller marks the build failed); on a partial failure the caller
 * reaps the half-created Vercel/Neon projects by the `superjam-<appId>` name.
 */
export const runDeploy = async (
  args: RunDeployArgs,
  deps: RunDeployDeps
): Promise<DeployResult> => {
  const { spec, buildId, appId, projectName } = args;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const emit = (kind: DeployEvent["kind"], label: string): void =>
    deps.onEvent?.({ kind, label });
  const started = now();

  emit("status", "generating");
  const app = await deps.generate(spec, { buildId, appId });

  let neonProjectId: string | undefined;
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
  const { projectId } = await deps.vercel.createProject(projectName);

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
  await deps.vercel.setEnv(projectId, env);

  emit("status", "deploying");
  const deployment = await deps.vercel.deploy({
    projectId,
    name: projectName,
    files: app.files,
    prebuilt: app.prebuilt,
  });

  await pollUntilReady(deployment.deploymentId, deps, sleep, now, emit);

  const entryUrl = deps.vercel.productionUrl(projectId, projectName);
  emit("status", "ready");

  return {
    entryUrl,
    manifest: app.manifest,
    vercelProjectId: projectId,
    neonProjectId,
    durationMs: now() - started,
  };
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

/** Whether an AppSpec declares any persistence → needs its own Neon project. */
export const specNeedsData = (spec: AppSpec): boolean =>
  spec.data.collections.length > 0 ||
  spec.data.counters.length > 0 ||
  spec.data.storage.length > 0;

/** DNS-safe Vercel/Neon project name, ≤100 chars (deploy doc §C). */
export const projectNameFor = (appId: string): string =>
  `superjam-${appId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 100);
