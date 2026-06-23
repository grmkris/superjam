// bridge.pot (§9/§12) — apps drive escrowed wagers through the host. Thin over
// createPotService; identity is the session user, appId from the trusted host
// map. create/stake are open to any logged-in user; resolve is creator-only
// (enforced in the service). The complex bits — receipt verification, idempotent
// pro-rata payout, AI-oracle resolve — live in the service.
import { AppId, typeIdValidator } from "@superjam/shared";
import { z } from "zod";
import type { ApiContext } from "../context.ts";
import { requireApp } from "../lib/app-context.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { TxHash } from "../lib/validators.ts";
import { protectedProcedure } from "../orpc.ts";
import { createPotService } from "../services/pot-service.ts";

const PotId = typeIdValidator("pot");

const svc = (context: Pick<ApiContext, "db" | "onchain" | "oracle">) =>
  createPotService({
    db: context.db,
    onchain: context.onchain,
    oracle: context.oracle,
  });

export const potBridge = {
  create: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        question: z.string().min(1).max(280),
        options: z.array(z.string().min(1).max(80)).min(2).max(8),
        deadline: z.coerce.date().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return svc(context).create(input.appId, context.user.id, {
        question: input.question,
        options: input.options,
        deadline: input.deadline,
      });
    }),

  stake: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        potId: PotId,
        option: z.string().min(1),
        txHash: TxHash,
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return tryOnchain(() =>
        svc(context).stake(
          input.appId,
          { id: context.user.id, walletAddress: context.user.walletAddress },
          {
            potId: input.potId,
            option: input.option,
            txHash: input.txHash as `0x${string}`,
          }
        )
      );
    }),

  get: protectedProcedure
    .input(z.object({ appId: AppId, potId: PotId }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return svc(context).get(input.appId, input.potId, context.user.id);
    }),

  resolve: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        potId: PotId,
        resolvedOption: z.string().min(1).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return tryOnchain(() =>
        svc(context).resolve(input.appId, context.user.id, {
          potId: input.potId,
          resolvedOption: input.resolvedOption,
        })
      );
    }),
};
