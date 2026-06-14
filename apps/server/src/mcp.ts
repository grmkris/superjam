// SuperJam MCP server (§MCP) — lets an external agent (a user's Claude Code) act
// AS the user: discover builders, upload reference files, and hire a builder to
// build + deploy an app, paid via the user's Dynamic-DELEGATED wallet (the proven
// Circle x402 path). Auth is a `sjat_…` Personal Access Token in the Authorization
// header (resolved to the user by the shared auth middleware); the tools call the
// EXISTING oRPC procedures in-process via `call()` with that user's context.
//
// Mounted in the apps/server Hono app at `/mcp`. Stateless StreamableHTTP: a fresh
// McpServer + transport per request, bound to the request's auth headers.
import { call } from "@orpc/server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type ApiContext, appRouter } from "@superjam/api";
import type { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

type MakeContext = (headers: Headers) => ApiContext;

const ok = (data: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    },
  ],
});
const fail = (e: unknown) => ({
  content: [
    { type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` },
  ],
  isError: true,
});

/** Build a per-request McpServer whose tools run AS the bearer's user. Exported
 *  for in-process testing (connect a Client via InMemoryTransport). */
export const buildServer = (makeContext: MakeContext, headers: Headers): McpServer => {
  const server = new McpServer({ name: "superjam", version: "0.1.0" });
  const ctx = (): ApiContext => makeContext(headers);

  server.registerTool(
    "discover_builders",
    {
      description:
        "List SuperJam builder agents you can hire to build + deploy an app. Returns each builder's id, name, slug, capabilities and price in USDC.",
      inputSchema: {},
    },
    async () => {
      try {
        const builders = await call(appRouter.agents.list, undefined as never, {
          context: ctx(),
        });
        return ok(builders);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "upload_file",
    {
      description:
        "Upload a reference file (image/PDF/CSV/text) to attach to a build. Returns { key, url }; pass the key in build_app.attachmentKeys.",
      inputSchema: {
        fileName: z.string(),
        mimeType: z.string(),
        dataBase64: z.string().describe("The file bytes, base64-encoded."),
      },
    },
    async ({ fileName, mimeType, dataBase64 }) => {
      try {
        const res = await call(
          appRouter.uploads.create,
          { fileName, mimeType: mimeType as never, dataBase64 },
          { context: ctx() }
        );
        return ok(res);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "build_app",
    {
      description:
        "Hire a builder to build + deploy an app from a prompt. Pays the build fee via your delegated SuperJam wallet (or free if eligible). Returns { buildId } — poll with get_build. If the idea needs clarification it returns { status: 'needs_answers', questions }: re-call with `answers`.",
      inputSchema: {
        builderId: z.string().describe("A builder id from discover_builders."),
        prompt: z.string().describe("What to build, e.g. 'a snake game'."),
        answers: z
          .array(z.object({ q: z.string(), a: z.string() }))
          .optional()
          .describe("Answers to a prior needs_answers response."),
        attachmentKeys: z
          .array(z.string())
          .optional()
          .describe("Keys from upload_file."),
      },
    },
    async ({ builderId, prompt, answers, attachmentKeys }) => {
      try {
        const context = ctx();
        const refined = await call(
          appRouter.builds.refine,
          { prompt, answers, attachmentKeys },
          { context }
        );
        if (refined.type !== "spec") {
          return ok({ status: "needs_answers", questions: refined.questions });
        }
        const spec = refined.spec;
        if (!spec) return fail(new Error("refiner returned no spec"));
        const pay = await call(
          appRouter.builds.payBuildFee,
          { builderId: builderId as never },
          { context }
        );
        const created = await call(
          appRouter.builds.create,
          {
            spec,
            agentId: builderId as never,
            payment: { via: "x402" as const, token: pay.paymentToken },
            attachmentKeys,
          },
          { context }
        );
        return ok({ ...created, paidFree: pay.free, settlement: pay.txHash });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "get_build",
    {
      description:
        "Check a build's status + the deployed app URL. status: queued|generating|done|failed; appStatus 'listed' ⇒ the app is live at its slug.",
      inputSchema: { buildId: z.string() },
    },
    async ({ buildId }) => {
      try {
        const status = await call(
          appRouter.builds.status,
          { buildId: buildId as never },
          { context: ctx() }
        );
        return ok(status);
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
};

/** Mount the MCP endpoint on the apps/server Hono app. */
export const registerMcp = (
  app: Hono,
  deps: { makeContext: MakeContext }
): void => {
  app.all("/mcp", async (c) => {
    // @hono/node-server exposes the raw Node req/res; the transport writes the
    // JSON-RPC response directly to `outgoing`, so we return RESPONSE_ALREADY_SENT.
    const env = c.env as unknown as {
      incoming: IncomingMessage;
      outgoing: ServerResponse;
    };
    const body =
      c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;
    const server = buildServer(deps.makeContext, c.req.raw.headers);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    env.outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(env.incoming, env.outgoing, body);
    return RESPONSE_ALREADY_SENT as never;
  });
};
