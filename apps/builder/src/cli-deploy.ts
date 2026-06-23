// CLI deploy — the deploy mechanism for builder-generated apps (pivot: the build
// agent / orchestration ships a Next app to Vercel cloud with the `vercel` CLI,
// NOT the REST API and NOT the Vercel MCP, which only advises "run vercel
// deploy"). `vercel deploy --yes` runs Vercel's native remote build and prints a
// JSON result to stdout (progress → stderr), so the deployment URL capture is a
// single deterministic parse.
//
// This is the deterministic deployer (used when the agent path is unavailable)
// AND the reference for what the build agent runs in its own session. The
// subprocess is injectable so CI never deploys live.
import { sanitizeProjectName } from "@superjam/builder/deploy";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * DNS-safe Vercel project name. Thin alias of the canonical `sanitizeProjectName`
 * (packages/builder/deploy) — ONE sanitizer shared with `projectNameFor`, so the
 * deploy name can never drift from the project Vercel actually creates (an earlier
 * `_`-vs-`-` divergence here recorded dead entryUrls; see vercel-alias.ts).
 */
export const vercelProjectName = sanitizeProjectName;

export interface CliDeployArgs {
  /** The generated app as a path→source map. */
  files: Record<string, string>;
  /** DNS-safe project name prefix (the workspace dir → the Vercel project name). */
  name: string;
  /** Operator token for the systemd service; omit to use the box's logged-in CLI. */
  token?: string;
}

export interface CliDeployResult {
  /**
   * The PUBLIC production alias `https://<project>.vercel.app` — this is what the
   * platform frames. The team protects the hashed per-deployment URL (401), but
   * the production alias is public, so we always deploy `--prod` and return it.
   */
  entryUrl: string;
  deploymentId: string;
  /** The hashed per-deployment URL (protected) — diagnostic only. */
  deploymentUrl: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a subprocess to completion. Injectable so tests never spawn `vercel`. */
export type DeployRunner = (argv: string[], cwd: string) => Promise<RunResult>;

const bunRunner: DeployRunner = async (argv, cwd) => {
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
};

/** Extract the per-deployment URL + id from `vercel deploy` output (JSON on
 * stdout; falls back to the last *.vercel.app line for older CLIs). Exported for
 * testing. */
export const parseDeployOutput = (
  stdout: string
): { deploymentUrl: string; deploymentId: string } => {
  try {
    const json = JSON.parse(stdout) as {
      deployment?: { url?: string; id?: string };
    };
    const url = json.deployment?.url;
    if (url) {
      return { deploymentUrl: url, deploymentId: json.deployment?.id ?? "" };
    }
  } catch {
    // not JSON — fall through to the text scan
  }
  const matches = stdout.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi);
  if (matches?.length) {
    return { deploymentUrl: matches[matches.length - 1]!, deploymentId: "" };
  }
  throw new Error(
    `vercel deploy: could not parse a deployment URL from:\n${stdout.slice(-400)}`
  );
};

/**
 * Write the app to a clean workspace and `vercel deploy --yes --prod` it. Returns
 * the PUBLIC production alias `https://<project>.vercel.app` (framable) plus the
 * deployment id. Throws on a non-zero exit (stderr in the message).
 */
export const cliDeploy = async (
  args: CliDeployArgs,
  run: DeployRunner = bunRunner
): Promise<CliDeployResult> => {
  // The workspace basename becomes the Vercel project name → its production
  // alias is https://<project>.vercel.app.
  const project = vercelProjectName(args.name);
  const ws = join(tmpdir(), project);
  await rm(ws, { recursive: true, force: true });
  await mkdir(ws, { recursive: true });
  try {
    await Promise.all(
      Object.entries(args.files).map(async ([path, src]) => {
        const abs = join(ws, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, src);
      })
    );
    // --prod so the public production alias updates (the hashed URL is protected).
    const argv = ["vercel", "deploy", "--yes", "--prod"];
    if (args.token) argv.push("--token", args.token);

    const { code, stdout, stderr } = await run(argv, ws);
    if (code !== 0) {
      throw new Error(`vercel deploy failed (exit ${code}): ${stderr.slice(-400)}`);
    }
    const { deploymentUrl, deploymentId } = parseDeployOutput(stdout);
    return {
      entryUrl: `https://${project}.vercel.app`,
      deploymentId,
      deploymentUrl,
    };
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
};

/**
 * `vercel remove <project> --yes` — idempotent teardown of a deployed app's
 * project. A missing project is treated as success (already gone). Throws on
 * other errors. (`vercel remove <name>` removes the whole project; `project rm`
 * has no non-interactive flag.)
 */
export const vercelRemove = async (
  projectName: string,
  opts: { token?: string } = {},
  run: DeployRunner = bunRunner
): Promise<void> => {
  const name = vercelProjectName(projectName);
  const argv = ["vercel", "remove", name, "--yes"];
  if (opts.token) argv.push("--token", opts.token);
  const { code, stderr } = await run(argv, tmpdir());
  if (code !== 0 && !/not found|does not exist|no project|no deployments/i.test(stderr)) {
    throw new Error(`vercel remove failed (exit ${code}): ${stderr.slice(-300)}`);
  }
};
