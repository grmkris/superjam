// auth router (§1) — mints the platform identity token for an external app.
// Called host-side (the host bridge routes the child's auth.getToken here),
// never by the iframe directly: appId is validated against the registry and the
// token is bound to the SESSION user, so a jam can only ever get a token for
// the user the host already authenticated, scoped to that one app.
import { schema } from "@superjam/db";
import { AppId } from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generatePat } from "../auth/pat.ts";
import { requireApp } from "../lib/app-context.ts";
import { protectedProcedure } from "../orpc.ts";

const { userToken } = schema;

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

  // Personal Access Token — the user authorizes an external agent (their Claude
  // Code, via the SuperJam MCP) to act AS them. The raw `sjat_…` token is returned
  // ONCE; we store only its hash. The agent then builds + pays via the user's
  // Dynamic-delegated wallet. WorldVerified-gated (a real human authorizes it).
  issueToken: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        /** Optional lifetime in days; absent ⇒ never expires (revoke by delete). */
        expiresInDays: z.number().int().positive().max(365).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const { raw, hash, preview } = generatePat();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;
      await context.db.insert(userToken).values({
        userId: context.user.id,
        name: input.name,
        tokenHash: hash,
        tokenPreview: preview,
        expiresAt,
      });
      // `token` is shown ONCE — it is never retrievable again.
      return { token: raw, preview, expiresAt };
    }),

  // List the caller's PATs (previews only — never the raw token). For a settings UI.
  listTokens: protectedProcedure.handler(async ({ context }) => {
    const rows = await context.db.query.userToken.findMany({
      where: eq(userToken.userId, context.user.id),
      columns: { id: true, name: true, tokenPreview: true, expiresAt: true, lastUsedAt: true, createdAt: true },
      orderBy: [desc(userToken.createdAt)],
    });
    return rows;
  }),

  // Revoke a PAT (owner-scoped).
  revokeToken: protectedProcedure
    .input(z.object({ tokenId: z.string() }))
    .handler(async ({ context, input }) => {
      const res = await context.db
        .delete(userToken)
        .where(
          and(eq(userToken.id, input.tokenId as never), eq(userToken.userId, context.user.id))
        );
      if (!res.rowCount) throw new ORPCError("NOT_FOUND", { message: "Token not found" });
      return { ok: true as const };
    }),
};
