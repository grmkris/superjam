// SandboxBackend — STUB. This is the seam for a future isolated-execution backend
// built on @vercel/sandbox (ephemeral Firecracker microVMs): an untrusted build
// would run its shell + filesystem inside a throwaway VM instead of on the host,
// so a malicious spec can't reach the builder's credentials or other workspaces.
// Implementing it means mapping writeFiles/readFile/exec onto the sandbox SDK's
// file + command APIs and dispose() onto sandbox teardown. Until then, selecting
// it is a hard error — run with BUILD_BACKEND=local.
//
// NOTE: the @vercel/sandbox dependency is intentionally NOT added yet.
import type { BackendFactory, BuildBackend, ExecOpts, ExecResult } from "./types.ts";

const NOT_IMPLEMENTED =
  "sandbox backend not implemented — set BUILD_BACKEND=local";

export class SandboxBackend implements BuildBackend {
  readonly workdir: string;

  constructor(workdir: string) {
    this.workdir = workdir;
  }

  writeFiles(_map: Record<string, string>): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  readFile(_path: string): Promise<string> {
    throw new Error(NOT_IMPLEMENTED);
  }

  exec(_cmd: string, _opts?: ExecOpts): Promise<ExecResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  dispose(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

export const makeSandboxBackend: BackendFactory = (workdir) =>
  new SandboxBackend(workdir);
