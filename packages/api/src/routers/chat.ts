// chat router (§3e) — user↔user direct messages (friendship-gated): threads,
// history, send text, share a jam / challenge, record a tip line, mark read.
import { CHAT_TEXT_MAX } from "@superjam/shared";
import { z } from "zod";
import { protectedProcedure } from "../orpc.ts";
import { createChatService } from "../services/chat-service.ts";

export const chatRouter = {
  threads: protectedProcedure.handler(({ context }) =>
    createChatService({
      db: context.db,
      rateLimiter: context.rateLimiter,
    }).threads(context.user.id)
  ),

  history: protectedProcedure
    .input(z.object({ withUsername: z.string().min(1), cursor: z.string().optional() }))
    .handler(({ context, input }) =>
      createChatService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).history(context.user.id, input.withUsername, input.cursor)
    ),

  send: protectedProcedure
    .input(z.object({ to: z.string().min(1), text: z.string().min(1).max(CHAT_TEXT_MAX) }))
    .handler(({ context, input }) =>
      createChatService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).send(
        { id: context.user.id, username: context.user.username },
        input.to,
        input.text
      )
    ),

  shareJam: protectedProcedure
    .input(
      z.object({
        to: z.string().min(1),
        jamSlug: z.string().min(1),
        challenge: z.boolean().optional(),
        note: z.string().max(500).optional(),
      })
    )
    .handler(({ context, input }) =>
      createChatService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).shareJam(
        { id: context.user.id, username: context.user.username },
        input.to,
        input.jamSlug,
        input.challenge,
        input.note
      )
    ),

  recordTip: protectedProcedure
    .input(z.object({ to: z.string().min(1), txHash: z.string().min(1) }))
    .handler(({ context, input }) =>
      createChatService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).recordTip(
        { id: context.user.id, username: context.user.username },
        input.to,
        input.txHash,
        context.onchain
      )
    ),

  markRead: protectedProcedure
    .input(z.object({ withUsername: z.string().min(1) }))
    .handler(({ context, input }) =>
      createChatService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).markRead(context.user.id, input.withUsername)
    ),
};
