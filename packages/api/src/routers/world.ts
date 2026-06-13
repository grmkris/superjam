// World router (§14, M8) — the human gate. `rpContext` bootstraps the IDKit v4
// widget with the server-provided app_id + action; `verify` does the BACKEND
// validation that the hard track requires (forward the proof to World, then
// bind the returned nullifier to this user). One human = one account: a
// nullifier already linked to a different user is refused — this is the sybil
// wall every human-only surface (publish, reviews, register-builder) sits behind.
import { schema } from "@superjam/db";
import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { WorldVerifier } from "../auth/world.ts";
import type { ApiContext } from "../context.ts";
import { protectedProcedure } from "../orpc.ts";

const { user } = schema;
type User = typeof schema.user.$inferSelect;

// The IDKit ISuccessResult shape. Validated then forwarded AS-IS (auth/world.ts).
const WorldProofInput = z.object({
  merkle_root: z.string().min(1),
  nullifier_hash: z.string().min(1),
  proof: z.string().min(1),
  verification_level: z.string().min(1),
});

// World verify needs a runtime `WorldVerifier`. Rather than widen the shared
// ApiContext, this lane declares the dependency locally (mirrors orpc.ts's
// requireWorldVerified); the integrator provides it once at createContext.
// `world?` is optional in the type (so the shared context still satisfies it)
// but asserted present here, narrowing it to non-null for handlers.
const withWorld = os
  .$context<ApiContext & { user: User; world?: WorldVerifier }>()
  .middleware(({ context, next }) => {
    if (!context.world) {
      throw new ORPCError("INTERNAL", {
        message: "World verifier not configured",
      });
    }
    return next({ context: { world: context.world } });
  });

const worldProcedure = protectedProcedure.use(withWorld);

export const worldRouter = {
  // Server-provided context for the IDKit v4 widget (app_id + action). The
  // proof is produced client-side against this action and validated by verify().
  // SPEC-GAP: if v4 later requires a server-FETCHED signed rp_context blob,
  // fetch it here through the same seam — the widget contract stays {appId,action}.
  rpContext: worldProcedure.handler(({ context }) => ({
    appId: context.world.appId(),
    action: context.world.action(),
  })),

  // Backend proof validation (hard track requirement). Forwards the proof to
  // World as-is; on success binds the nullifier to this account.
  verify: worldProcedure
    .input(z.object({ proof: WorldProofInput, signal: z.string().optional() }))
    .handler(async ({ context, input }) => {
      const result = await context.world.verifyProof({
        proof: input.proof,
        signal: input.signal,
      });
      if (!result.ok) {
        throw new ORPCError("BAD_REQUEST", {
          message: `World verification failed: ${result.detail}`,
        });
      }
      const { nullifierHash } = result;

      // Sybil wall + idempotent: a nullifier already on a DIFFERENT account is
      // refused (one human backs exactly one account); re-verifying the same
      // account with the same nullifier just re-affirms it.
      const existing = await context.db.query.user.findFirst({
        where: eq(user.worldNullifierHash, nullifierHash),
      });
      if (existing && existing.id !== context.user.id) {
        throw new ORPCError("CONFLICT", {
          message: "This World ID is already linked to another account.",
        });
      }

      await context.db
        .update(user)
        .set({ worldVerified: true, worldNullifierHash: nullifierHash })
        .where(eq(user.id, context.user.id));

      return {
        worldVerified: true,
        verificationLevel: result.verificationLevel,
      };
    }),
};
