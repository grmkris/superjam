// friends router (§3e) — instant + mutual crew. add/remove/list, all
// auth-gated (not worldVerified; friending shouldn't require World).
import { z } from "zod";
import { protectedProcedure } from "../orpc.ts";
import { createFriendService } from "../services/friend-service.ts";

export const friendsRouter = {
  list: protectedProcedure.handler(({ context }) =>
    createFriendService({ db: context.db }).list(context.user.id)
  ),

  add: protectedProcedure
    .input(z.object({ username: z.string().min(1) }))
    .handler(({ context, input }) =>
      createFriendService({ db: context.db }).add(context.user.id, input.username)
    ),

  remove: protectedProcedure
    .input(z.object({ username: z.string().min(1) }))
    .handler(({ context, input }) =>
      createFriendService({ db: context.db }).remove(
        context.user.id,
        input.username
      )
    ),
};
