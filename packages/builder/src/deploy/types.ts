// Deploy orchestration ports (pivot §6 / deploy design doc). The builder is a
// HOSTING PROVIDER: generate a Next.js app from the AppSpec → provision Neon
// (if the app declares data) → deploy to Vercel → return an entryUrl. Every
// external service is behind a narrow port so the orchestration is unit-tested
// with STUBBED clients (no live deploy in CI); the dev box runs one real deploy
// as the live check. The builder holds its OWN operator creds (Vercel token +
// team, org Neon key) inside the client impls — never injected into the app.
import type { AppManifest, AppSpec } from "@superjam/shared";

/** A deployable Next.js app: file map + the manifest + whether it needs a DB. */
export interface GeneratedApp {
  /** path → source, the Next app dir (or a prebuilt `.vercel/output` tree). */
  files: Record<string, string>;
  /** Validated by the platform before any registration (§11). */
  manifest: AppManifest;
  /** True when the spec declares collections/counters/storage → provision Neon. */
  needsData: boolean;
  /** True when `files` is a prebuilt Build Output API tree (skip remote build). */
  prebuilt: boolean;
}

/**
 * Fill the Next.js template from the spec (agent edits a Next app, not one
 * file). Production wires the Agent SDK / template fill on the builder box;
 * tests inject a deterministic stub.
 */
export type Generator = (
  spec: AppSpec,
  ctx: GenerateContext
) => Promise<GeneratedApp>;

export interface GenerateContext {
  buildId: string;
  /** Pre-generated app id, injected as SUPERJAM_APP_ID (JWT `aud`). */
  appId: string;
}

// --- Neon ---

export interface NeonProject {
  projectId: string;
  /** Pooled (PgBouncer) DSN → runtime DATABASE_URL on Vercel. */
  pooledDsn: string;
  /** Direct DSN → build-time migrations (DDL can't run through the pooler). */
  directDsn: string;
}

export interface NeonClient {
  createProject(name: string): Promise<NeonProject>;
  /** Idempotent teardown (orphan GC / app delete). */
  deleteProject(projectId: string): Promise<void>;
}

// --- Vercel ---

export interface VercelEnvVar {
  key: string;
  value: string;
  type: "plain" | "encrypted";
}

export interface VercelDeployment {
  deploymentId: string;
  /** `<name>-<hash>.vercel.app` deployment URL. */
  url: string;
  readyState: "QUEUED" | "INITIALIZING" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
}

export interface VercelClient {
  createProject(name: string): Promise<{ projectId: string }>;
  /** Upsert env — MUST run before deploy; env is baked at build time. */
  setEnv(projectId: string, vars: VercelEnvVar[]): Promise<void>;
  /** Upload files + create the production deployment. */
  deploy(args: {
    projectId: string;
    name: string;
    files: Record<string, string>;
    prebuilt: boolean;
  }): Promise<VercelDeployment>;
  getDeployment(deploymentId: string): Promise<VercelDeployment>;
  /** The project's production URL once a deployment is READY. */
  productionUrl(projectId: string, name: string): string;
  /** Idempotent teardown. */
  deleteProject(projectId: string): Promise<void>;
}

// --- orchestration result ---

export interface DeployResult {
  entryUrl: string;
  manifest: AppManifest;
  vercelProjectId: string;
  /** Only set when the app declared data (its own Neon project). */
  neonProjectId?: string;
  durationMs: number;
}

export interface DeployEvent {
  kind: "status" | "error";
  label: string;
}
