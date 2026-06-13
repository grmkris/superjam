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

// The IDKit v4 result shape (IDKitResultV4). Validated then forwarded AS-IS to
// World's verify endpoint (auth/world.ts); the RP-scoped nullifier rides in
// responses[]. Optional fields are kept so the whole result reaches verify.
const WorldResponseItem = z.object({
  identifier: z.string().min(1),
  signal_hash: z.string().optional(),
  proof: z.array(z.string()),
  nullifier: z.string().min(1),
  issuer_schema_id: z.number(),
  expires_at_min: z.number(),
});
const WorldProofInput = z.object({
  protocol_version: z.string().min(1),
  nonce: z.string().min(1),
  action: z.string().min(1),
  environment: z.string().min(1),
  responses: z.array(WorldResponseItem).min(1),
  user_presence_completed: z.boolean().optional(),
  identity_attested: z.boolean().optional(),
  integrity_bundle: z.unknown().optional(),
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
  // Server-SIGNED context for the IDKit v4 widget: app_id + action + the
  // rp_context blob (rp_id, nonce, created_at, expires_at, signature) the widget
  // can't open without. A fresh nonce/signature is minted per call (managed RP
  // self-signs via signRequest, auth/world.ts).
  rpContext: worldProcedure.handler(({ context }) => context.world.rpContext()),

  // Backend proof validation (hard track requirement). Forwards the v4 result to
  // World as-is; on success binds the RP-scoped nullifier to this account.
  verify: worldProcedure
    .input(z.object({ result: WorldProofInput }))
    .handler(async ({ context, input }) => {
      const result = await context.world.verifyProof({ result: input.result });
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
