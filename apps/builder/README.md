# SuperJam Builder

A **builder** turns a refined `AppSpec` into a live, hosted mini-app and hands SuperJam an
`entryUrl`. SuperJam frames that URL cross-origin; the app talks back through `@superjam/sdk`.
This is the **house builder** — but the protocol is open, so anyone can run their own
(see [Build your own builder](#build-your-own-builder)).

```
AppSpec ──▶ generate (Next.js + SDK [+ Neon schema])
        ──▶ provision Neon (if the app stores its own data)
        ──▶ deploy to Vercel ──▶ poll READY ──▶ { entryUrl, manifest }
```

## The generation engine (`src/agent-generate.ts`)

Generation is a pluggable `Generator` port (`@superjam/builder/deploy`). Two impls:

- **`createTemplateGenerator`** (`src/generate.ts`) — deterministic skeleton: correct auth /
  db / config / manifest boilerplate + a placeholder page. Always works; no LLM.
- **`createAgentGenerator`** (`src/agent-generate.ts`) — the **agent-fill** engine: drives an
  LLM agent over that skeleton to write a *real* `app/page.tsx` (+ `app/api/*` routes for
  own-backend apps), guided by the **recipe corpus** (`recipes/`). On any agent error or
  incomplete output it returns the skeleton — the agent makes apps better, never fails a build.

The heavy Claude Agent SDK is injected as an `AgentRunner` port, so the engine is unit-tested
with a stub (`src/agent-generate.test.ts`) and the dependency lives only in the adapter.

### Wiring it (one line in `src/server.ts`)

```ts
import { createAgentGenerator } from "./agent-generate.ts";
import { createClaudeAgentRunner } from "./claude-runner.ts";

const generate = (await claudeAuth())            // the box's `claude auth status`
  ? createAgentGenerator({ runAgent: createClaudeAgentRunner() })
  : createTemplateGenerator();                   // skeleton-only when unauthed
const runner = createBuildRunner({ generate, vercel, neon, jwksUrl: env.SUPERJAM_JWKS_URL, maxConcurrent: env.MAX_CONCURRENT_BUILDS });
```

### The runner adapter (`src/claude-runner.ts`) — needs the dep

Add `"@anthropic-ai/claude-agent-sdk"` to `package.json`, then:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { AgentRunner } from "./agent-generate.ts";

const SKIP = /(^|\/)(node_modules|\.next|\.git|\.vercel)(\/|$)/;

async function collect(ws: string, dir = ws, out: Record<string, string> = {}) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (SKIP.test(relative(ws, abs))) continue;
    if (e.isDirectory()) await collect(ws, abs, out);
    else out[relative(ws, abs)] = await readFile(abs, "utf8");
  }
  return out;
}

export const createClaudeAgentRunner = (opts?: { model?: string; maxTurns?: number }): AgentRunner =>
  async ({ system, prompt, files }) => {
    const ws = await mkdtemp(join(tmpdir(), "sj-build-"));
    try {
      for (const [p, src] of Object.entries(files)) {
        const abs = join(ws, p);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, src);
      }
      const run = query({
        prompt,
        options: {
          cwd: ws,
          systemPrompt: system,
          model: opts?.model ?? "claude-fable-5",
          maxTurns: opts?.maxTurns ?? 24,
          // PoC §11: allowedTools doesn't restrict — use disallowedTools; gate paths in a hook.
          disallowedTools: ["Bash", "Task", "WebFetch", "WebSearch"],
          hooks: {
            PreToolUse: [async (input: { tool_input?: Record<string, unknown> }) => {
              const p = (input.tool_input?.file_path ?? input.tool_input?.path) as string | undefined;
              if (p && !resolve(ws, p).startsWith(ws)) return { decision: "block", reason: "path escapes workspace" };
              return {};
            }],
          },
          env: { HOME: process.env.HOME, PATH: process.env.PATH },
        },
      });
      for await (const _ of run) { /* drain (optionally surface events) */ }
      return await collect(ws);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  };
```

> Hook/option shapes track the installed `@anthropic-ai/claude-agent-sdk` version — adjust if
> the API differs. The model is `claude-fable-5` (PoC-proven fast fill); no API key — the
> agent uses the box's `claude` subscription auth.

## The recipe corpus (`recipes/`)

Starting patterns the agent imitates, selected per spec by `selectRecipes` (skill → category →
keyword). Read `recipes/_base.md` (the external-app contract) then the archetype recipes:
`quiz · game · poll-charts · market · predict · judge · data · social · realtime` (catalog in
`recipes/INDEX.md`). Most are **zero-backend** (platform `sdk.data`/`counter`/`pot`/`ai`);
only `data` (and sometimes `social`) use the app's own Neon backend (`apps/example-app` is the
reference shape).

## The builder protocol

The platform dispatches every build to a single house builder, configured via
`BUILDER_URL` + `BUILDER_TOKEN` on the server (the open marketplace was removed). A builder
implements the HTTP protocol (`src/app.ts`):

| Route | Behavior |
|---|---|
| `POST /builds` (Bearer) | accept `{ spec, buildId, appId }` → `202`; `429` when at capacity |
| `GET /builds/:id` (Bearer) | `{ status: "running"\|"done"\|"failed", result?: { entryUrl, manifest }, error? }` |
| `GET /health` | `{ status, claudeAuth }` |

Generate however you like, deploy to your own infra, and return a public `entryUrl`. To point
the platform at a different builder, set `BUILDER_URL`/`BUILDER_TOKEN` on the server service.
