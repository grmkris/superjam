// auth router (§1) — mints the platform identity token for an external app.
// Called host-side (the host bridge routes the child's auth.getToken here),
// never by the iframe directly: appId is validated against the registry and the
// token is bound to the SESSION user, so a jam can only ever get a token for
// the user the host already authenticated, scoped to that one app.
import { AppId } from "@superjam/shared";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import { protectedProcedure } from "../orpc.ts";

export const authRouter = {
  // → { token, exp } — exp is epoch-seconds; the SDK re-fetches before expiry.
  mintAppToken: protectedProcedure
    .input(z.object({ appId: AppId }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return context.issuer.mint({
        userId: context.user.id,
        username: context.user.username,
        worldVerified: context.user.worldVerified,
        appId: input.appId,
      });
    }),
};
