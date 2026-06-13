// builds router (§11) — the front door to the build pipeline.
//
// Stage 0 `refine` (idea → AppSpec): protected, does NOT consume the free
// build, capped at REFINE_CALLS_PER_USER_DAY. The refiner runs PLATFORM-side
// (Gemini via @superjam/builder) so the wizard stays alive when the builder box
// is busy/down.
//
// Stage 1+ `create` (the build): enforces the trial quota (free build #1, then
// worldVerified — or a verified USDC receipt to pay past it), inserts the build
// row, then ALLOCATES the app row up front (status 'building') to get the real
// appId — which is baked into the deploy as SUPERJAM_APP_ID (the JWT aud), so
// `app.id` is guaranteed to equal the token audience. The async driver dispatches
// the AppSpec to a builder (apps/builder, pivot §6: it DEPLOYS + returns an
// entryUrl), then FINALIZES the app (attaches entryUrl + lists it).
//
// Two cross-lane seams are wired as DI deps that no-op/log until they land, so a
// half-built environment still works and a finalize/ENS failure NEVER fails a
// build (§11): `verifyPayment` (C's verifyUsdcTransfer) and the deploy dispatch
// (the live builder, M5). `refine` + `deploy` are stubbed in tests.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppManifest,
  type AppSpec,
  AppId,
  AppSpecSchema,
  BuildId,
  BuilderAgentId,
  FREE_BUILDS,
  LIST_MAX,
  REFINE_CALLS_PER_USER_DAY,
  type RefineResult,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Address, type Hex, isAddressEqual } from "viem";
import type { Logger } from "@superjam/logger";
import type { Onchain } from "@superjam/onchain";
import { PUBLIC_CHAIN, parseUsdc } from "@superjam/onchain";
import {
  type BuildDeployer,
  createRemoteDeployer,
} from "../lib/builder-dispatch.ts";
import { isUniqueViolation } from "../lib/db-errors.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { protectedProcedure } from "../orpc.ts";
import { type SelectedBuilder, selectEligibleBuilder } from "./agents.ts";
import { allocateExternalApp, finalizeExternalApp } from "./apps.ts";
import type { RefineCatalogApp, RefineInput } from "@superjam/builder";
import { refine as defaultRefine } from "@superjam/builder";

const { app, build, builderAgent } = schema;

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

/** Build a deployer for a chosen marketplace agent's endpoint (§14). */
export type DeployerFor = (builder: {
  endpointUrl: string;
  token: string;
}) => BuildDeployer;

export interface BuildsRouterDeps {
  refine?: RefineFn;
  /** Dispatch a spec to a builder + await the deploy result (the house builder). */
  deploy?: BuildDeployer;
  /** Build a deployer for a routed marketplace agent. Tests inject a stub. */
  deployerFor?: DeployerFor;
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

/** The AppManifest is derivable from the (validated) AppSpec — no deploy needed,
 * so the app row can be allocated before the build runs. */
const manifestFromSpec = (spec: AppSpec): AppManifest => ({
  name: spec.name,
  slug: spec.slug,
  description: spec.description,
  iconEmoji: spec.iconEmoji,
  category: spec.category,
  capabilities: spec.capabilities,
});

/**
 * The async build driver. The app row is ALREADY allocated (status 'building',
 * its id baked into the deploy as SUPERJAM_APP_ID). This dispatches to a builder
 * (which deploys + returns an entryUrl), then FINALIZES the app (attaches the
 * entryUrl + lists it). NEVER throws — failures land on the build row so the web
 * feed shows them. Finalize is best-effort (§11): an ENS / finalize failure
 * leaves the build done but the app un-listed (still 'building'); it does not
 * fail the build. A deploy FAILURE leaves the allocated row 'building'
 * (invisible — apps.get skips it); a stale-building reaper is a follow-up.
 */
export const runBuild = async (
  db: Database,
  logger: Logger,
  deploy: BuildDeployer,
  args: {
    buildId: BuildRow["id"];
    appId: AppId;
    spec: AppSpec;
    /** The marketplace agent this build was routed to (§14) — credited a build
     *  on success. Null ⇒ the house builder (env deployer). */
    routedAgentId?: BuilderAgentId | null;
  },
  /** Passed to finalize for the best-effort ENS mint (§16). Omitted in tests. */
  onchain?: Onchain
): Promise<void> => {
  const { buildId, appId, spec, routedAgentId } = args;
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

    // Credit the marketplace agent a build + link the minted app to it
    // (§14/§16) on successful dispatch. builtByAgentId is the basis for
    // review→reputation; written independently of the best-effort finalize.
    if (routedAgentId) {
      await db
        .update(builderAgent)
        .set({ buildsCount: sql`${builderAgent.buildsCount} + 1` })
        .where(eq(builderAgent.id, routedAgentId));
      await db
        .update(app)
        .set({ builtByAgentId: routedAgentId })
        .where(eq(app.id, appId));
    }

    try {
      await finalizeExternalApp(db, { appId, entryUrl: result.entryUrl }, onchain, logger);
    } catch (err) {
      logger.error(
        { err: String(err), buildId },
        "app finalize failed — build stays done, app un-listed (never fails the build)"
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
  const deployerFor =
    deps.deployerFor ??
    ((b) => createRemoteDeployer({ url: b.endpointUrl, token: b.token }));
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
          /** The marketplace agent the wizard picked (§14). Absent ⇒ auto/house. */
          agentId: BuilderAgentId.optional(),
          /** Receipt to pay past the free-trial gate. */
          payment: z
            .object({ txHash: z.string().min(1), chain: z.string().min(1) })
            .optional(),
        })
      )
      .handler(async ({ context, input }) => {
        // Pick the marketplace builder up front (pure read): a PAID pick gates
        // payment, and an explicit paid pick must be verified BEFORE we allocate
        // anything. A routing hiccup is non-fatal — it falls back to the house
        // builder (and a free house build skips the agent-payment gate below).
        let selected: SelectedBuilder | null = null;
        try {
          selected = await selectEligibleBuilder(context.db, input.spec, {
            agentId: input.agentId,
          });
        } catch (err) {
          context.logger.warn(
            { err: String(err), agentId: input.agentId },
            "builder routing failed — falling back to the house builder"
          );
        }

        // Trial quota (platform anti-spam): build #1 is free; past it you must
        // be world-verified OR present a verified USDC receipt (§11). Orthogonal
        // to the agent's price below — worldVerified skips THIS gate, not the fee.
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

        // Paid-to-agent gate (§14) — the "I paid another human's AI" moment. A
        // chosen agent with a price must be paid in USDC to ITS wallet, proven by
        // the receipt's Transfer log (≥ price, from the user's own wallet).
        // Verified before dispatch; the txHash is recorded UNIQUE on the build.
        const paidAgent =
          selected && Number(selected.agent.priceUsdc) > 0 ? selected.agent : null;
        if (paidAgent) {
          if (!input.payment) {
            throw new ORPCError("PAYMENT_REQUIRED", {
              message: `Pay ${paidAgent.priceUsdc} USDC to build with ${paidAgent.name}.`,
            });
          }
          if (!context.user.walletAddress) {
            throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
          }
          const { from } = await tryOnchain(() =>
            context.onchain.verifyUsdcTransfer({
              hash: input.payment!.txHash as Hex,
              chain: PUBLIC_CHAIN,
              expectedTo: paidAgent.walletAddress as Address,
              minAmount: parseUsdc(paidAgent.priceUsdc),
            })
          );
          if (!isAddressEqual(from, context.user.walletAddress as Address)) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Pay the builder from your own wallet",
            });
          }
        }

        let buildId: BuildRow["id"];
        try {
          const [row] = await context.db
            .insert(build)
            .values({
              userId: context.user.id,
              prompt: input.prompt ?? input.spec.description,
              spec: input.spec,
              status: "queued",
              agentId: selected?.agent.id ?? null,
              paymentTxHash: paidAgent ? input.payment!.txHash : null,
            })
            .returning({ id: build.id });
          buildId = row!.id;
        } catch (err) {
          // A reused agent-payment receipt trips the unique paymentTxHash index.
          if (isUniqueViolation(err)) {
            throw new ORPCError("CONFLICT", {
              message: "This payment was already used",
            });
          }
          throw err;
        }

        // Allocate the app row up front → the REAL appId, baked into the deploy
        // as SUPERJAM_APP_ID so app.id == the minted token's aud (§1). Status
        // stays 'building' (invisible) until runBuild finalizes it.
        const allocated = await allocateExternalApp(context.db, {
          manifest: manifestFromSpec(input.spec),
          ownerUserId: context.user.id,
          buildId,
        });
        await context.db
          .update(build)
          .set({ appId: allocated.id })
          .where(eq(build.id, buildId));

        const buildDeployer = selected ? deployerFor(selected) : deploy;

        // Fire-and-forget; the driver never throws (it records failures on the
        // build row). The web feed polls build.events / status.
        void runBuild(
          context.db,
          context.logger,
          buildDeployer,
          {
            buildId,
            appId: allocated.id,
            spec: input.spec,
            routedAgentId: selected?.agent.id ?? null,
          },
          context.onchain
        );

        return { buildId, appId: allocated.id, status: "queued" as const };
      }),

    // Poll a build's progress (DESIGN_BRIEF §3c-vii workshop). Owned-by-caller.
    // The web animates from status/events, then routes to the reveal once the
    // build is done AND the app is finalized (listed/deployed) — runBuild marks
    // the build done before finalize, so an ENS/finalize hiccup leaves the app
    // un-listed while the build reads done.
    status: protectedProcedure
      .input(z.object({ buildId: BuildId }))
      .handler(async ({ context, input }) => {
        const row = await context.db.query.build.findFirst({
          where: eq(build.id, input.buildId),
        });
        if (!row) {
          throw new ORPCError("NOT_FOUND", { message: "Build not found" });
        }
        if (row.userId !== context.user.id) {
          throw new ORPCError("FORBIDDEN", { message: "Not your build" });
        }
        let slug: string | null = null;
        let appStatus: string | null = null;
        if (row.appId) {
          const a = await context.db.query.app.findFirst({
            columns: { slug: true, status: true },
            where: eq(app.id, row.appId),
          });
          slug = a?.slug ?? null;
          appStatus = a?.status ?? null;
        }
        return {
          status: row.status,
          error: row.error,
          events: row.events,
          appId: row.appId,
          slug,
          appStatus,
        };
      }),
  };
};

export const buildsRouter = createBuildsRouter();
