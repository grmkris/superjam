// claude-runner — the AgentRunner adapter for R's createAgentGenerator. Drives
// the subscription-authed `claude` (Agent SDK `query()`) over a seeded workspace
// to fill the generated app (real UI + @superjam/sdk usage). The agent only
// generates files — it has NO Bash (so it can't deploy); the orchestration
// deploys the returned files via cliDeploy. Sandboxed: a throwaway tmp workspace
// (cwd), no Bash/Task/Web tools, and a PreToolUse hook that blocks any write
// escaping the workspace. No API key — the box's `claude` subscription.
//
// API shapes match @anthropic-ai/claude-agent-sdk@0.3.177 (verified against its
// .d.ts): hooks are matcher-wrapped (`{PreToolUse:[{hooks:[cb]}]}`), the hook
// callback is `(input, toolUseID, options)`, and headless file edits need
// `permissionMode:"bypassPermissions"` + `allowDangerouslySkipPermissions`.
import {
  type HookCallback,
  type HookJSONOutput,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { AgentRunner } from "./agent-generate.ts";

const SKIP = /(^|\/)(node_modules|\.next|\.git|\.vercel)(\/|$)/;

/** Recursively read the workspace into a path→source map (skipping build dirs). */
const collect = async (
  ws: string,
  dir: string = ws,
  out: Record<string, string> = {}
): Promise<Record<string, string>> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (SKIP.test(relative(ws, abs))) continue;
    if (entry.isDirectory()) await collect(ws, abs, out);
    else out[relative(ws, abs)] = await readFile(abs, "utf8");
  }
  return out;
};

/** Block any tool write whose path escapes the workspace (defense in depth). */
const pathGate =
  (ws: string): HookCallback =>
  async (input): Promise<HookJSONOutput> => {
    const ti = (input as { tool_input?: Record<string, unknown> }).tool_input;
    const p = (ti?.file_path ?? ti?.path) as string | undefined;
    if (p && !resolve(ws, p).startsWith(ws)) {
      return { decision: "block", reason: "path escapes workspace" };
    }
    return {};
  };

export const createClaudeAgentRunner = (opts?: {
  model?: string;
  maxTurns?: number;
}): AgentRunner =>
  async ({ system, prompt, files }) => {
    const ws = await mkdtemp(join(tmpdir(), "sj-agent-"));
    try {
      // Seed the workspace with the deterministic skeleton the agent fills.
      await Promise.all(
        Object.entries(files).map(async ([p, src]) => {
          const abs = join(ws, p);
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, src);
        })
      );

      const run = query({
        prompt,
        options: {
          cwd: ws,
          systemPrompt: system,
          // claude-fable-5 (R's README) is unavailable on the subscription;
          // sonnet is a strong, available coding model for app generation.
          model: opts?.model ?? "claude-sonnet-4-6",
          maxTurns: opts?.maxTurns ?? 24,
          // Headless: auto-accept the agent's file edits (it's our own agent in
          // a throwaway sandbox; Bash/Task/Web are disallowed below).
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          disallowedTools: ["Bash", "Task", "WebFetch", "WebSearch"],
          hooks: { PreToolUse: [{ hooks: [pathGate(ws)] }] },
        },
      });
      for await (const _msg of run) {
        // drain the stream; the result is the mutated workspace
      }
      return await collect(ws);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  };
