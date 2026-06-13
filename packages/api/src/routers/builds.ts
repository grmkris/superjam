// builds router (§11) — the front door to the build pipeline.
//
// Stage 0 `refine` (idea → AppSpec): protected, does NOT consume the free
// build, capped at REFINE_CALLS_PER_USER_DAY. The refiner runs PLATFORM-side
// (Gemini via @superjam/builder) so the wizard stays alive when the builder box
// is busy/down.
//
// Stage 1+ `create` (the build): enforces the trial quota (free build #1, then
// worldVerified — or a verified USDC receipt to pay past it), inserts the build
// row, mints the appId up front (it's baked into the deploy as SUPERJAM_APP_ID),
// and fires the async build driver. The driver dispatches the AppSpec to a
// builder agent (apps/builder, pivot §6: it DEPLOYS + returns an entryUrl), then
// registers the app via createExternalApp.
//
// Two cross-lane seams are wired as DI deps that no-op/log until they land, so a
// half-built environment still works and a registration/ENS failure NEVER fails
// a build (§11): `verifyPayment` (C's verifyUsdcTransfer) and the deploy
// dispatch (the live builder, M5). `refine` + `deploy` are stubbed in tests.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppSpec,
  AppId,
  AppSpecSchema,
  FREE_BUILDS,
  LIST_MAX,
  REFINE_CALLS_PER_USER_DAY,
  type RefineResult,
  typeIdGenerator,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Logger } from "@superjam/logger";
import {
  type BuildDeployer,
  createRemoteDeployer,
} from "../lib/builder-dispatch.ts";
import { protectedProcedure } from "../orpc.ts";
import { createExternalApp } from "./apps.ts";
import type { RefineCatalogApp, RefineInput } from "@superjam/builder";
import { refine as defaultRefine } from "@superjam/builder";

const { app, build } = schema;

type BuildRow = typeof build.$inferSelect;
type UserRow = typeof schema.user.$inferSelect;

/** The refine seam: production = Gemini; tests inject a canned result. */
export type RefineFn = (input: RefineInput) => Promise<RefineResult>;

/** A build payment proof (paying past the free-trial gate). */
export interface BuildPayment {
  txHash: string;
  chain: string;
}
/**
 * The paid-build receipt verifier (C's verifyUsdcTransfer). Throws to reject.
 * Default no-ops + logs until C's verifier lands — a missing verifier must not
 * silently let unpaid builds through in production, so the default LOGS loudly.
 */
export type BuildPaymentVerifier = (
  payment: BuildPayment,
  ctx: { userId: string; logger: Logger }
) => Promise<void>;

export interface BuildsRouterDeps {
  refine?: RefineFn;
  /** Dispatch a spec to a builder + await the deploy result. */
  deploy?: BuildDeployer;
  verifyPayment?: BuildPaymentVerifier;
}

/** Default deployer: remote dispatch to BUILDER_URL (unset ⇒ build fails clean). */
const envRemoteDeployer = (): BuildDeployer => {
  const url = process.env.BUILDER_URL;
  const token = process.env.BUILDER_TOKEN;
  if (!url || !token) {
    return async () => {
      throw new Error("no builder configured (BUILDER_URL/BUILDER_TOKEN unset)");
    };
  }
  return createRemoteDeployer({ url, token });
};

const noopPaymentVerifier: BuildPaymentVerifier = async (payment, ctx) => {
  ctx.logger.warn(
    { txHash: payment.txHash, chain: payment.chain },
    "build payment verifier not wired — accepting receipt unverified (dev seam)"
  );
};

/** Listed apps rendered into the similar-check prompt (capped, first-pass only). */
const listedCatalog = async (db: Database): Promise<RefineCatalogApp[]> => {
  const rows = await db.query.app.findMany({
    where: eq(app.status, "listed"),
    columns: { slug: true, name: true, description: true, category: true },
    limit: LIST_MAX,
  });
  return rows;
};

/** The base app's current spec, for remix re-refines. Missing ⇒ undefined. */
const loadBaseSpec = async (
  db: Database,
  appId: AppId
): Promise<AppSpec | undefined> => {
  const baseApp = await db.query.app.findFirst({
    where: eq(app.id, appId),
    columns: { currentBuildId: true },
  });
  if (!baseApp?.currentBuildId) return undefined;
  const baseBuild = await db.query.build.findFirst({
    where: eq(build.id, baseApp.currentBuildId),
    columns: { spec: true },
  });
  return baseBuild?.spec ?? undefined;
};

const userBuildCount = async (
  db: Database,
  userId: UserRow["id"]
): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(build)
    .where(eq(build.userId, userId));
  return row?.n ?? 0;
};

/**
 * The async build driver. Dispatches to a builder (which deploys + returns an
 * entryUrl), then registers the app. NEVER throws — failures land on the build
 * row so the web feed shows them. Registration is best-effort (§11): an ENS /
 * createExternalApp failure marks the build done-but-unregistered, it does not
 * fail the build.
 */
export const runBuild = async (
  db: Database,
  logger: Logger,
  deploy: BuildDeployer,
  args: {
    buildId: BuildRow["id"];
    appId: string;
    spec: AppSpec;
    ownerUserId: UserRow["id"];
  }
): Promise<void> => {
  const { buildId, appId, spec, ownerUserId } = args;
  try {
    await db.update(build).set({ status: "generating" }).where(eq(build.id, buildId));
    const result = await deploy({ spec, buildId, appId });

    await db
      .update(build)
      .set({
        status: "done",
        manifest: result.manifest,
        durationMs: result.durationMs,
      })
      .where(eq(build.id, buildId));

    try {
      // SEAM (P1, %67): createExternalApp mints its OWN row id, so it diverges
      // from `appId` baked into the deploy as SUPERJAM_APP_ID (the JWT `aud`).
      // For aud to bind, createExternalApp must adopt a passed-in id — a
      // one-line follow-up in apps.ts. The build/register flow itself is correct.
      const registered = await createExternalApp(db, {
        manifest: result.manifest,
        entryUrl: result.entryUrl,
        ownerUserId,
        buildId,
      });
      await db
        .update(build)
        .set({ appId: registered.id })
        .where(eq(build.id, buildId));
    } catch (err) {
      logger.error(
        { err: String(err), buildId },
        "app registration failed — build stays done, app unlisted (never fails the build)"
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, buildId }, "build failed");
    await db
      .update(build)
      .set({ status: "failed", error: message })
      .where(eq(build.id, buildId));
  }
};

export const createBuildsRouter = (deps: BuildsRouterDeps = {}) => {
  const runRefine = deps.refine ?? defaultRefine;
  const deploy = deps.deploy ?? envRemoteDeployer();
  const verifyPayment = deps.verifyPayment ?? noopPaymentVerifier;

  return {
    refine: protectedProcedure
      .input(
        z.object({
          prompt: z.string().min(1).max(2000),
          answers: z
            .array(z.object({ q: z.string(), a: z.string() }))
            .max(8)
            .optional(),
          remixOfAppId: AppId.optional(),
        })
      )
      .handler(async ({ context, input }): Promise<RefineResult> => {
        const quotaKey = `refine:${context.user.id}`;
        const q = context.rateLimiter.quota(quotaKey, REFINE_CALLS_PER_USER_DAY);
        if (!q.ok) {
          throw new ORPCError("QUOTA_EXCEEDED", {
            message: "Daily refine limit reached — try again tomorrow.",
          });
        }

        // Similar-check only on the first pass: skip it on adjust re-refines
        // (answers present) and remixes, for wizard latency (§11).
        const firstPass = !input.answers?.length && !input.remixOfAppId;
        const catalog = firstPass ? await listedCatalog(context.db) : undefined;
        const baseSpec = input.remixOfAppId
          ? await loadBaseSpec(context.db, input.remixOfAppId)
          : undefined;

        try {
          return await runRefine({
            prompt: input.prompt,
            answers: input.answers,
            baseSpec,
            catalog,
          });
        } catch (err) {
          // A refiner failure isn't the user's fault — give the unit back.
          context.rateLimiter.refund(quotaKey);
          context.logger.error({ err: String(err) }, "refine failed");
          throw new ORPCError("INTERNAL", {
            message: "The refiner is unavailable right now. Try again.",
          });
        }
      }),

    create: protectedProcedure
      .input(
        z.object({
          spec: AppSpecSchema,
          /** The original idea, for the build feed. Defaults to the description. */
          prompt: z.string().min(1).max(2000).optional(),
          remixOfAppId: AppId.optional(),
          /** Receipt to pay past the free-trial gate. */
          payment: z
            .object({ txHash: z.string().min(1), chain: z.string().min(1) })
            .optional(),
        })
      )
      .handler(async ({ context, input }) => {
        // Trial quota: build #1 is free; past it you must be world-verified OR
        // present a verified USDC receipt (§11/§14).
        const prior = await userBuildCount(context.db, context.user.id);
        if (prior >= FREE_BUILDS && !context.user.worldVerified) {
          if (!input.payment) {
            throw new ORPCError("FORBIDDEN", {
              message: "Verify you're human (or pay) to keep building.",
            });
          }
          try {
            await verifyPayment(input.payment, {
              userId: context.user.id,
              logger: context.logger,
            });
          } catch (err) {
            throw new ORPCError("PAYMENT_REQUIRED", {
              message: err instanceof Error ? err.message : "Payment not verified.",
            });
          }
        }

        // Mint the appId up front — it's baked into the deploy as the JWT aud.
        const appId = typeIdGenerator("app");
        const [row] = await context.db
          .insert(build)
          .values({
            userId: context.user.id,
            prompt: input.prompt ?? input.spec.description,
            spec: input.spec,
            status: "queued",
          })
          .returning({ id: build.id });
        const buildId = row!.id;

        // Fire-and-forget; the driver never throws (it records failures on the
        // build row). The web feed polls build.events / status.
        void runBuild(context.db, context.logger, deploy, {
          buildId,
          appId,
          spec: input.spec,
          ownerUserId: context.user.id,
        });

        return { buildId, appId, status: "queued" as const };
      }),
  };
};

export const buildsRouter = createBuildsRouter();
