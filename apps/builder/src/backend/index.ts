// Build-execution backend seam — pick a substrate with BUILD_BACKEND (local|sandbox).
export type {
  BackendFactory,
  BuildBackend,
  ExecOpts,
  ExecResult,
} from "./types.ts";
export { LocalBackend, makeLocalBackend } from "./local.ts";
export { SandboxBackend, makeSandboxBackend } from "./sandbox.ts";
