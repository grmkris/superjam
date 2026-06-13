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
  /** Pre-generated app id, BAKED into the source as SUPERJAM_APP_ID (JWT `aud`). */
  appId: string;
  /** Platform JWKS the app verifies tokens against, baked as SUPERJAM_JWKS_URL.
   * Optional so generators may default it (https://superjam.fun/...). */
  jwksUrl?: string;
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

// --- Vercel (CLI deploy) ---

/**
 * Deploy a generated app (file map) to Vercel and return its PUBLIC production
 * URL. Backed by `vercel deploy --prod` (apps/builder/cli-deploy.ts); injected
 * so the orchestration is unit-tested without a live deploy. Identity is baked
 * into the source, so there is no env-injection step.
 */
export type DeployPort = (args: {
  files: Record<string, string>;
  /** DNS-safe project name → its production alias `https://<name>.vercel.app`. */
  name: string;
}) => Promise<{ entryUrl: string; deploymentId: string }>;

/** Idempotent `vercel rm <projectName>` — reaping a failed build / teardown. */
export type VercelTeardown = (projectName: string) => Promise<void>;

// --- orchestration result ---

export interface DeployResult {
  entryUrl: string;
  manifest: AppManifest;
  /** The Vercel project NAME (stable, for teardown via `vercel rm`). */
  vercelProject: string;
  /** Only set when the app declared data (its own Neon project). */
  neonProjectId?: string;
  durationMs: number;
}

export interface DeployEvent {
  kind: "status" | "error";
  label: string;
}
