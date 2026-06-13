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

// Viewer-aware public: resolve `user` when a valid bearer is present, else stay
// anonymous (no throw). For public surfaces that personalize when logged in —
// e.g. the feed's liked-by-me / friends signals.
const maybeAuth = base.middleware(async ({ context, next }) => {
  const token = extractBearer(context.headers);
  if (!token) return next({ context: { user: undefined as User | undefined } });
  try {
    const claims = await context.auth.verify(token);
    const user = await upsertUserFromClaims(context.db, claims);
    return next({ context: { user: user as User | undefined } });
  } catch {
    return next({ context: { user: undefined as User | undefined } });
  }
});

export const optionalAuthProcedure = base.use(maybeAuth);

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
