// In-process build runner (§11) — max-N concurrent, no external queue. The
// builder keeps NO durable state: build status lives in memory and the platform
// polls GET /builds/:id, mirroring events into its own build.events. When the
// builder is at capacity it answers 429 and the PLATFORM's FIFO holds + retries
// (it owns durability, the builder owns execution).
//
// Pure-agentic build path: `start()` launches the autonomous agent (deps.runBuild)
// which does the WHOLE build itself — implement, provision its DB, deploy — and
// POSTs progress + a terminal `done`/`failed` to /builds/:id/report. `report()`
// applies those to the in-memory state; the platform's poll sees them. The agent
// process ending without a `done` report ⇒ failed (no deterministic fallback).
import type { DeployEvent, DeployResult } from "@superjam/builder/deploy";
import type { AppManifest, AppSpec } from "@superjam/shared";

export interface BuildRunnerDeps {
  /**
   * Launch the autonomous agent for ONE build and resolve when its process ends.
   * The agent drives progress/result via the report callback (it is handed the
   * reportToken). Provided by server.ts (which knows the callback port).
   */
  runBuild: (args: {
    spec: AppSpec;
    buildId: string;
    appId: string;
    reportToken: string;
    /** Presigned GET URLs for user reference attachments (§17). */
    attachmentUrls?: string[];
    /** The calling env's JWKS url — baked into the jam (overrides the box default). */
    jwksUrl?: string;
  }) => Promise<void>;
  maxConcurrent?: number;
  /** Injected clock (durationMs); defaults to Date.now. */
  now?: () => number;
  /** Per-build secret minter; defaults to crypto.randomUUID. */
  mintToken?: () => string;
  /**
   * Resolve the REAL deploy URL from the agent-reported Vercel project + its
   * guessed URL (Vercel truncates long auto-aliases, so the guess can 404).
   * Defaults to a pass-through (returns the fallback); server.ts injects the
   * live Vercel resolver. NEVER throws — a build is never blocked on this.
   */
  resolveEntryUrl?: (vercelProject: string, fallback: string) => Promise<string>;
}

export interface BuildState {
  buildId: string;
  status: "running" | "done" | "failed";
  events: DeployEvent[];
  result?: DeployResult;
  error?: string;
  /**
   * Per-build secret handed to the autonomous agent so it can POST progress +
   * the finish signal to /builds/:id/report. Scoped to one build (not the global
   * BUILDER_TOKEN), so a build agent can only touch its own build.
   */
  reportToken?: string;
}

/**
 * What the autonomous build agent POSTs to /builds/:id/report — progress updates
 * while it works, then a single terminal `done` (with the resources it created,
 * for teardown) or `failed`. A PUBLIC builder-protocol contract (community agents
 * report the same shape).
 */
export type AgentReport =
  | { kind: "status"; label: string }
  | {
      kind: "done";
      entryUrl: string;
      /** Vercel project NAME (for `vercel rm` teardown). */
      vercelProject: string;
      /** Neon project id, when the agent provisioned a DB (for teardown). */
      neonProjectId?: string;
      /** For onchain games: the Base contract address + ABI the agent deployed. */
      contractAddress?: string;
      contractAbi?: readonly unknown[];
    }
  | { kind: "failed"; error: string };

export type ReportOutcome = "ok" | "unauthorized" | "not_found";

export interface StartArgs {
  spec: AppSpec;
  buildId: string;
  appId: string;
  /** Presigned GET URLs for user reference attachments (§17), forwarded to the agent. */
  attachmentUrls?: string[];
  /** The calling env's JWKS url — baked into the jam (overrides the box default). */
  jwksUrl?: string;
}

export interface BuildRunner {
  atCapacity(): boolean;
  start(args: StartArgs): BuildState;
  get(buildId: string): BuildState | undefined;
  /** Apply an agent report to a build (token-gated). Async: a `done` report
   *  resolves the real Vercel alias before recording the result. */
  report(buildId: string, token: string, report: AgentReport): Promise<ReportOutcome>;
  /** Resolve once the given build leaves `running` (test seam). */
  wait(buildId: string): Promise<void>;
}

/** The AppManifest is a subset of the spec — derive it (the agent need not report it). */
const manifestFromSpec = (spec: AppSpec): AppManifest => ({
  name: spec.name,
  slug: spec.slug,
  description: spec.description,
  iconEmoji: spec.iconEmoji,
  category: spec.category,
  capabilities: spec.capabilities,
});

export const createBuildRunner = (deps: BuildRunnerDeps): BuildRunner => {
  const max = deps.maxConcurrent ?? 2;
  const now = deps.now ?? Date.now;
  const mintToken = deps.mintToken ?? (() => crypto.randomUUID());
  const resolveEntryUrl =
    deps.resolveEntryUrl ?? ((_project, fallback) => Promise.resolve(fallback));
  const builds = new Map<string, BuildState>();
  const pending = new Map<string, Promise<void>>();
  // Per-build context report() needs to assemble a DeployResult on `done`.
  const ctx = new Map<string, { spec: AppSpec; startedAt: number }>();
  let active = 0;

  return {
    atCapacity: () => active >= max,

    start({ spec, buildId, appId, attachmentUrls, jwksUrl }): BuildState {
      const reportToken = mintToken();
      const state: BuildState = { buildId, status: "running", events: [], reportToken };
      builds.set(buildId, state);
      ctx.set(buildId, { spec, startedAt: now() });
      active += 1;

      const job = deps
        .runBuild({ spec, buildId, appId, reportToken, attachmentUrls, jwksUrl })
        .then(() => {
          // The agent process ended. A `done`/`failed` report should have set the
          // terminal status; if it's still running, the agent never signalled.
          if (state.status === "running") {
            state.status = "failed";
            state.error = "agent ended without reporting a result";
            state.events.push({ t: now(), kind: "error", label: state.error });
          }
        })
        .catch((err: unknown) => {
          // Only the agent LAUNCH/process failing lands here; a reported failure
          // already set the state.
          if (state.status === "running") {
            state.status = "failed";
            state.error = err instanceof Error ? err.message : String(err);
            state.events.push({ t: now(), kind: "error", label: state.error });
          }
        })
        .finally(() => {
          active -= 1;
        });

      pending.set(buildId, job);
      return state;
    },

    async report(buildId, token, report): Promise<ReportOutcome> {
      const state = builds.get(buildId);
      if (!state) return "not_found";
      if (!state.reportToken || token !== state.reportToken) return "unauthorized";
      // A terminal build ignores further reports (idempotent / late curls).
      if (state.status !== "running") return "ok";

      if (report.kind === "status") {
        state.events.push({ t: now(), kind: "status", label: report.label });
      } else if (report.kind === "done") {
        const c = ctx.get(buildId);
        // Override the agent's GUESSED URL with the real Vercel production alias
        // (best-effort; falls back to the report on failure). Resolve BEFORE
        // marking done so a poller never sees the guess.
        const entryUrl = await resolveEntryUrl(report.vercelProject, report.entryUrl);
        state.status = "done";
        state.result = {
          entryUrl,
          manifest: manifestFromSpec(c?.spec ?? ({} as AppSpec)),
          vercelProject: report.vercelProject,
          neonProjectId: report.neonProjectId,
          gameContract:
            report.contractAddress && report.contractAbi
              ? { address: report.contractAddress, abi: report.contractAbi }
              : undefined,
          durationMs: c ? now() - c.startedAt : 0,
        };
      } else {
        state.status = "failed";
        state.error = report.error;
        state.events.push({ t: now(), kind: "error", label: report.error });
      }
      return "ok";
    },

    get: (buildId) => builds.get(buildId),
    wait: (buildId) => pending.get(buildId) ?? Promise.resolve(),
  };
};
