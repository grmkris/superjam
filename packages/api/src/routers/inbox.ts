// inbox router (§12) — the host /inbox page (Notifications). Distinct from
// bridge.messages (which apps call); this is the user-facing surface.
import { protectedProcedure } from "../orpc.ts";
import { createMessageService } from "../services/message-service.ts";

export const inboxRouter = {
  list: protectedProcedure.handler(({ context }) =>
    createMessageService({
      db: context.db,
      rateLimiter: context.rateLimiter,
    }).inbox(context.user.id)
  ),

  markRead: protectedProcedure.handler(async ({ context }) => {
    await createMessageService({
      db: context.db,
      rateLimiter: context.rateLimiter,
    }).markAllRead(context.user.id);
    return { ok: true } as const;
  }),
};
