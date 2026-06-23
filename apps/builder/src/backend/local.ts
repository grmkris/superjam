// LocalBackend — runs the build directly on the host the builder service lives on
// (the VPS, where workspaces persist under ~/superjam-builds). This is the default
// substrate; it mirrors what agent-build.ts does today (write skeleton files, run
// `vercel`, strip heavy dirs at the end) but behind the BuildBackend seam.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BackendFactory, BuildBackend, ExecOpts, ExecResult } from "./types.ts";

// 15 min — long enough for a full `npm i` + `vercel deploy`, short enough that a
// wedged command can't pin a build worker forever.
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// Heavy, regenerable dirs stripped from a finished workspace so the persisted copy
// stays a lightweight SOURCE archive — same set agent-build.ts strips on cleanup.
const HEAVY_DIRS = ["node_modules", ".next", ".vercel", ".git"];

export class LocalBackend implements BuildBackend {
  readonly workdir: string;

  constructor(workdir: string) {
    // Normalise once so every containment check compares against a canonical root.
    this.workdir = resolve(workdir);
  }

  /**
   * Resolve a caller-supplied relative path against the workdir and REJECT any
   * that escapes it (`..`, absolute paths, symlink-style traversal). Same spirit
   * as agent-build.ts's pathGate: `resolve(ws, p)` must stay under the workspace.
   * We also guard the `workdir` itself (escape would equal the root) by requiring
   * the resolved path to sit strictly inside, with a trailing separator so a
   * sibling like `/ws-evil` can't pass the `/ws` prefix test.
   */
  private resolveInside(path: string): string {
    const abs = resolve(this.workdir, path);
    const root = this.workdir.endsWith("/") ? this.workdir : `${this.workdir}/`;
    if (abs !== this.workdir && !abs.startsWith(root)) {
      throw new Error(`path escapes workspace: ${path}`);
    }
    return abs;
  }

  async writeFiles(map: Record<string, string>): Promise<void> {
    await Promise.all(
      Object.entries(map).map(async ([rel, src]) => {
        const abs = this.resolveInside(rel);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, src);
      })
    );
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.resolveInside(path), "utf8");
  }

  /**
   * Run a shell command via `bash -lc` (so the build can use shell features and a
   * login env, matching the agent's Bash). NEVER throws on a non-zero exit — the
   * exit code is part of the result. On timeout we kill the process and synthesize
   * code 124 (the conventional timeout code) with a stderr note. Only a genuine
   * spawn failure (binary missing, etc.) propagates as a throw.
   */
  async exec(cmd: string, opts?: ExecOpts): Promise<ExecResult> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const proc = Bun.spawn({
      cmd: ["bash", "-lc", cmd],
      cwd: opts?.cwd ?? this.workdir,
      env: { ...process.env, ...opts?.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    try {
      // Drain both streams fully BEFORE awaiting exit so a chatty command can't
      // deadlock on a full pipe buffer.
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      if (timedOut) {
        return {
          code: 124,
          stdout,
          stderr: `${stderr}\n[backend] command timed out after ${timeoutMs}ms`,
        };
      }
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Best-effort cleanup. Local convention: KEEP the workspace (the jam's source
   * must survive for fixing/redeploying), just strip the heavy regenerable dirs to
   * keep the persisted copy small. Idempotent and non-throwing — a failed strip
   * must never fail a build.
   */
  async dispose(): Promise<void> {
    await Promise.all(
      HEAVY_DIRS.map((d) =>
        rm(join(this.workdir, d), { recursive: true, force: true }).catch(() => {})
      )
    );
  }
}

export const makeLocalBackend: BackendFactory = (workdir) => new LocalBackend(workdir);
