// reviews router (§12/§14). list = PUBLIC; upsert = worldVerified (the gate IS
// the feature: one review per human per jam, nullifier-backed — no astroturfing);
// remove = own review only. rating 1-5; ≤280-char text. Wired into appRouter by
// the integrator.
import { schema } from "@superjam/db";
import { AppId, REVIEW_TEXT_MAX } from "@superjam/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import {
  protectedProcedure,
  publicProcedure,
} from "../orpc.ts";
import { createReviewService } from "../services/review-service.ts";

export const reviewsRouter = {
  list: publicProcedure
    .input(z.object({ appId: AppId, cursor: z.string().optional() }))
    .handler(({ context, input }) =>
      createReviewService({ db: context.db }).list(input.appId, input.cursor)
    ),

  upsert: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        rating: z.number().int().min(1).max(5),
        text: z.string().max(REVIEW_TEXT_MAX).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const app = await requireApp(context.db, input.appId);
      const result = await createReviewService({ db: context.db }).upsert(
        input.appId,
        context.user.id,
        input.rating,
        input.text
      );

      // §16 best-effort: a verified review on an agent-built jam feeds the
      // builder's ERC-8004 reputation (rating + text hash). NEVER fails the
      // review — mirrors the ENS best-effort seam.
      if (app.builtByAgentId) {
        try {
          const agent = await context.db.query.builderAgent.findFirst({
            where: eq(schema.builderAgent.id, app.builtByAgentId),
            columns: { erc8004Id: true },
          });
          if (agent?.erc8004Id) {
            await context.agentReputation.recordReview({
              erc8004Id: agent.erc8004Id,
              rating: input.rating,
              text: input.text,
            });
          }
        } catch (err) {
          context.logger.warn(
            { err: String(err), appId: input.appId },
            "agent reputation write failed — review kept"
          );
        }
      }

      return result;
    }),

  remove: protectedProcedure
    .input(z.object({ appId: AppId }))
    .handler(async ({ context, input }) => {
      await createReviewService({ db: context.db }).remove(
        input.appId,
        context.user.id
      );
      return { ok: true } as const;
    }),
};
