// In-process build runner (§11) — max-N concurrent, no external queue. The
// builder keeps NO durable state: build status lives in memory and the platform
// polls GET /builds/:id, mirroring events into its own build.events. When the
// builder is at capacity it answers 429 and the PLATFORM's FIFO holds + retries
// (it owns durability, the builder owns execution).
import {
  type DeployEvent,
  type DeployPort,
  type DeployResult,
  type Generator,
  type NeonClient,
  projectNameFor,
  runDeploy,
  type VercelTeardown,
} from "@superjam/builder/deploy";
import type { AppSpec } from "@superjam/shared";

export interface BuildRunnerDeps {
  generate: Generator;
  /** Ships the generated files to Vercel (cliDeploy). */
  deploy: DeployPort;
  /** `vercel rm` for reaping a failed build's project. */
  teardownVercel?: VercelTeardown;
  neon?: NeonClient;
  jwksUrl: string;
  maxConcurrent?: number;
}

export interface BuildState {
  buildId: string;
  status: "running" | "done" | "failed";
  events: DeployEvent[];
  result?: DeployResult;
  error?: string;
}

export interface StartArgs {
  spec: AppSpec;
  buildId: string;
  appId: string;
}

export interface BuildRunner {
  atCapacity(): boolean;
  start(args: StartArgs): BuildState;
  get(buildId: string): BuildState | undefined;
  /** Resolve once the given build leaves `running` (test seam). */
  wait(buildId: string): Promise<void>;
}

export const createBuildRunner = (deps: BuildRunnerDeps): BuildRunner => {
  const max = deps.maxConcurrent ?? 2;
  const builds = new Map<string, BuildState>();
  const pending = new Map<string, Promise<void>>();
  let active = 0;

  return {
    atCapacity: () => active >= max,

    start({ spec, buildId, appId }): BuildState {
      const state: BuildState = { buildId, status: "running", events: [] };
      builds.set(buildId, state);
      active += 1;

      const job = runDeploy(
        { spec, buildId, appId, projectName: projectNameFor(appId) },
        {
          generate: deps.generate,
          deploy: deps.deploy,
          teardownVercel: deps.teardownVercel,
          neon: deps.neon,
          jwksUrl: deps.jwksUrl,
          onEvent: (e) => state.events.push(e),
        }
      )
        .then((result) => {
          state.status = "done";
          state.result = result;
        })
        .catch((err: unknown) => {
          state.status = "failed";
          state.error = err instanceof Error ? err.message : String(err);
          state.events.push({ kind: "error", label: state.error });
        })
        .finally(() => {
          active -= 1;
        });

      pending.set(buildId, job);
      return state;
    },

    get: (buildId) => builds.get(buildId),
    wait: (buildId) => pending.get(buildId) ?? Promise.resolve(),
  };
};
