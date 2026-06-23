// The build-execution backend seam. A build (agent-build / cli-deploy) ultimately
// does three primitive things to a workspace: write source files, read a file
// back, and run shell commands. Today that's the LOCAL host the service runs on;
// tomorrow it could be an isolated microVM (Vercel Sandbox / Firecracker). Pulling
// those primitives behind one interface lets us swap the execution substrate
// (BUILD_BACKEND=local|sandbox) without touching the build logic.

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOpts {
  /** absolute cwd for the command; defaults to the backend workdir. */
  cwd?: string;
  /** extra env merged over the inherited process env. */
  env?: Record<string, string>;
  /** kill the process after this long, returning code 124 (default: 15 min). */
  timeoutMs?: number;
}

export interface BuildBackend {
  /** absolute root the build operates under (workspace dir) */
  readonly workdir: string;
  /** write a map of relative-path -> file contents into the workspace (creates dirs) */
  writeFiles(map: Record<string, string>): Promise<void>;
  /** read one file (relative to workdir) as utf-8 */
  readFile(path: string): Promise<string>;
  /** run a shell command in the workspace; never throws on non-zero exit — returns code+stdout+stderr */
  exec(cmd: string, opts?: ExecOpts): Promise<ExecResult>;
  /** cleanup hook (local: optionally strip heavy dirs / keep workspace). idempotent. */
  dispose(): Promise<void>;
}

export type BackendFactory = (workdir: string) => BuildBackend;
