// reviews router (§12/§14). list = PUBLIC; upsert = logged-in (one review per
// user per jam); remove = own review only. rating 1-5; ≤280-char text. Wired into
// appRouter by the integrator.
import { AppId, REVIEW_TEXT_MAX } from "@superjam/shared";
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
      await requireApp(context.db, input.appId);
      return createReviewService({ db: context.db }).upsert(
        input.appId,
        context.user.id,
        input.rating,
        input.text
      );
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
