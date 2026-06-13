// apps/builder — the token-gated public build executor (§11). A thin Hono shell
// over the build runner; the deploy pipeline lives in @superjam/builder. The
// contract is a PUBLIC PROTOCOL (this service is just pre-seeded registry row
// #1; community agents are more rows). Pivot change: the builder DEPLOYS and
// returns an entryUrl — it no longer returns bundles/sources.
//
// `createBuilderApp` takes its deps (token + runner) so tests drive it with
// stubbed Vercel/Neon clients — no live deploy in CI.
import type { TeardownArgs, TeardownResult } from "@superjam/builder/deploy";
import { AppSpecSchema } from "@superjam/shared";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import type { BuildRunner } from "./queue.ts";

export interface BuilderAppDeps {
  token: string;
  runner: BuildRunner;
  /**
   * Tear down an app's external projects (bound over the real clients in
   * server.ts). Absent ⇒ /teardown answers 501. The platform dispatches here
   * because operator creds live only on the builder box.
   */
  teardown?: (args: TeardownArgs) => Promise<TeardownResult>;
  /** Optional truthful `claude auth status` probe for /health. */
  claudeAuth?: () => Promise<boolean>;
}

const BuildRequest = z.object({
  spec: AppSpecSchema,
  buildId: z.string().min(1),
  // Pre-generated app id → injected as SUPERJAM_APP_ID (JWT aud) before deploy.
  appId: z.string().min(1),
});

const TeardownRequest = z.object({
  vercelProjectId: z.string().min(1).optional(),
  neonProjectId: z.string().min(1).optional(),
});

export const createBuilderApp = (deps: BuilderAppDeps): Hono => {
  const app = new Hono();

  // Bearer gate on the whole protocol surface (health stays public).
  const gate = async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.header("authorization") !== `Bearer ${deps.token}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
  app.use("/builds", gate);
  app.use("/builds/*", gate);
  app.use("/teardown", gate);

  app.post("/builds", async (c) => {
    const parsed = BuildRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "bad request", detail: z.prettifyError(parsed.error) }, 400);
    }
    // At capacity ⇒ 429; the platform FIFO holds the job and retries.
    if (deps.runner.atCapacity()) {
      return c.json({ error: "at capacity" }, 429);
    }
    const { spec, buildId, appId } = parsed.data;
    deps.runner.start({ spec, buildId, appId });
    return c.json({ buildId, status: "running" }, 202);
  });

  app.get("/builds/:id", (c) => {
    const state = deps.runner.get(c.req.param("id"));
    if (!state) return c.json({ error: "not found" }, 404);
    return c.json({
      status: state.status,
      events: state.events,
      result: state.result,
      error: state.error,
    });
  });

  // Synchronous (two idempotent DELETEs) — no queue/poll/concurrency cap.
  app.post("/teardown", async (c) => {
    if (!deps.teardown) {
      return c.json({ error: "teardown not configured" }, 501);
    }
    const parsed = TeardownRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "bad request", detail: z.prettifyError(parsed.error) }, 400);
    }
    const { vercelProjectId, neonProjectId } = parsed.data;
    if (!vercelProjectId && !neonProjectId) {
      return c.json({ error: "no project ids to tear down" }, 400);
    }
    const result = await deps.teardown({ vercelProjectId, neonProjectId });
    return c.json(result);
  });

  app.get("/health", async (c) => {
    const claudeAuth = deps.claudeAuth ? await deps.claudeAuth() : undefined;
    return c.json({ ok: true, claudeAuth });
  });

  return app;
};
