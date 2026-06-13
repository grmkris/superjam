// bridge.ai (§9/§12) — the host shell proxies a sandboxed jam's sdk.ai.* calls
// here. Identity is the session user; appId comes from the host's trusted
// Window→app map (never the child message). Two cost guards: an exact-match
// cache (a hit is FREE — no quota, no model call) and a per-(user, app) daily
// quota reusing the rate limiter's daily counter (§7, no parallel quota system).
//
// A factory (not a static object) so tests drive `chat` with a stubbed AiService
// — no Anthropic key in CI. bridge.ts spreads `createAiBridge()` (real service).
import { AI_CALLS_PER_USER_APP_DAY, AppId } from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import { protectedProcedure } from "../orpc.ts";
import {
  type AiService,
  AiRequestSchema,
  createAiService,
} from "../services/ai-service.ts";

export interface AiBridgeDeps {
  service?: AiService;
}

export const createAiBridge = (deps: AiBridgeDeps = {}) => {
  const service = deps.service ?? createAiService();

  return {
    chat: protectedProcedure
      .input(z.object({ appId: AppId, request: AiRequestSchema }))
      .handler(async ({ context, input }) => {
        await requireApp(context.db, input.appId);

        // A cache hit is free — return before touching the quota or the model.
        const cached = service.cached(input.appId, input.request);
        if (cached) return { result: cached, cached: true } as const;

        const quotaKey = `ai:${input.appId}:${context.user.id}`;
        const q = context.rateLimiter.quota(quotaKey, AI_CALLS_PER_USER_APP_DAY);
        if (!q.ok) {
          throw new ORPCError("QUOTA_EXCEEDED", {
            message: "Daily AI limit reached for this app — try again tomorrow.",
          });
        }

        try {
          const result = await service.run(input.appId, input.request);
          return { result, cached: false } as const;
        } catch (err) {
          // The model call failed — don't bill the user for it.
          context.rateLimiter.refund(quotaKey);
          context.logger.error({ err: String(err) }, "ai bridge call failed");
          throw new ORPCError("INTERNAL", {
            message: "The AI helper is unavailable right now. Try again.",
          });
        }
      }),
  };
};
