// Procedure builders + middleware chain (§12). publicProcedure → protected
// (Dynamic-auth'd, adds `user`) → worldVerified (gates the human-only surface).
import type { schema } from "@superjam/db";
import { ORPCError, os } from "@orpc/server";
import { extractBearer } from "./auth/bearer.ts";
import { upsertUserFromClaims } from "./auth/user-service.ts";
import type { ApiContext } from "./context.ts";
import { commonErrors } from "./errors.ts";

type User = typeof schema.user.$inferSelect;

export const base = os.$context<ApiContext>().errors(commonErrors);

export const publicProcedure = base;

// Verify the bearer token, upsert the user, narrow the context with `user`.
const requireAuth = base.middleware(async ({ context, next }) => {
  const token = extractBearer(context.headers);
  if (!token) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
  }
  let user: User;
  try {
    const claims = await context.auth.verify(token);
    user = await upsertUserFromClaims(context.db, claims);
  } catch (err) {
    context.logger.debug({ err: String(err) }, "auth verify failed");
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid token" });
  }
  return next({ context: { user } });
});

export const protectedProcedure = base.use(requireAuth);

// The human-only gate (publish, reviews, register-builder, top-up, …, §14).
// Authored against a user-aware context so `.use()` composes after requireAuth.
const requireWorldVerified = os
  .$context<ApiContext & { user: User }>()
  .middleware(async ({ context, next }) => {
    if (!context.user.worldVerified) {
      throw new ORPCError("FORBIDDEN", {
        message: "Verify you're human to keep jamming.",
      });
    }
    return next();
  });

export const worldVerifiedProcedure = protectedProcedure.use(
  requireWorldVerified
);
