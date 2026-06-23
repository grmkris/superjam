// builds router (§11) — the front door to the build pipeline.
//
// Stage 0 `refine` (idea → AppSpec): protected, does NOT consume the free
// build, capped at REFINE_CALLS_PER_USER_DAY. The refiner runs PLATFORM-side
// (Gemini via @superjam/builder) so the wizard stays alive when the builder box
// is busy/down.
//
// Stage 1+ `create` (the build): inserts the build row, then ALLOCATES the app row
// up front (status 'building') to get the real appId — which is baked into the
// deploy as SUPERJAM_APP_ID (the JWT aud), so `app.id` is guaranteed to equal the
// token audience. The async driver dispatches the AppSpec to a builder (apps/builder,
// pivot §6: it DEPLOYS + returns an entryUrl), then FINALIZES the app (attaches
// entryUrl + lists it).
//
// Builds are FREE — there's no build fee. Every build routes to a registered
// marketplace agent (no env "house" fallback; a build with no eligible agent is
// rejected). The deploy dispatch is a DI seam (the live builder, M5); `refine` +
// `deployerFor` are stubbed in tests.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppManifest,
  type AppSpec,
  AppId,
  AppSpecSchema,
  BUILD_ATTACH_MAX,
  BuildDraftId,
  BuildId,
  BuildStepSchema,
  BuilderAgentId,
  DraftStateSchema,
  LIST_MAX,
  REFINE_CALLS_PER_USER_DAY,
  type RefineResult,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Logger } from "@superjam/logger";
import type { Onchain } from "@superjam/onchain";
import {
  type BuildDeployer,
  createRemoteDeployer,
} from "../lib/builder-dispatch.ts";
import { modelMimeOf, presignAll } from "../lib/attachments.ts";
import { isUniqueViolation } from "../lib/db-errors.ts";
import { protectedProcedure } from "../orpc.ts";
import { type SelectedBuilder, selectEligibleBuilder } from "./agents.ts";
import { allocateExternalApp, finalizeExternalApp } from "./apps.ts";
import type { RefineCatalogApp, RefineInput } from "@superjam/builder";
import { refine as defaultRefine } from "@superjam/builder";

const { app, build, builderAgent, buildDraft } = schema;

type BuildRow = typeof build.$inferSelect;
type UserRow = typeof schema.user.$inferSelect;

/** The refine seam: production = Gemini; tests inject a canned result. */
export type RefineFn = (input: RefineInput) => Promise<RefineResult>;

/** Build a deployer for a chosen marketplace agent's endpoint (§14). */
export type DeployerFor = (builder: {
  endpointUrl: string;
  token: string;
}) => BuildDeployer;

export interface BuildsRouterDeps {
  refine?: RefineFn;
  /** Build a deployer for the routed marketplace agent. Tests inject a stub. */
  deployerFor?: DeployerFor;
}

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

/** The AppManifest is derivable from the (validated) AppSpec — no deploy needed,
 * so the app row can be allocated before the build runs. */
const manifestFromSpec = (spec: AppSpec): AppManifest => ({
  name: spec.name,
  slug: spec.slug,
  description: spec.description,
  iconEmoji: spec.iconEmoji,
  category: spec.category,
  // An onchain-game skill implies the "onchain" capability (sdk.onchain is
  // capability-gated by the host) — guarantee it even if the refiner forgot.
  capabilities: spec.skills?.includes("onchain")
    ? [...new Set([...spec.capabilities, "onchain" as const])]
    : spec.capabilities,
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
     *  on success. Always set from create(); optional only for direct unit tests. */
    routedAgentId?: BuilderAgentId | null;
    /** Presigned GET URLs for the user's reference attachments (§17) — forwarded
     *  to the builder agent's prompt so it can fetch images/CSV/Excel/PDF. */
    attachmentUrls?: string[];
  },
  /** Passed to finalize for the best-effort ENS mint (§16). Omitted in tests. */
  onchain?: Onchain
): Promise<void> => {
  const { buildId, appId, spec, routedAgentId, attachmentUrls } = args;
  try {
    await db.update(build).set({ status: "generating" }).where(eq(build.id, buildId));
    const result = await deploy({
      spec,
      buildId,
      appId,
      attachmentUrls,
      // Mirror the builder's live step timeline into build.events as it runs, so
      // the workshop + history read real progress from the DB. Best-effort: a
      // persist hiccup never fails the build.
      onProgress: (events) => {
        void (async () => {
          try {
            await db.update(build).set({ events }).where(eq(build.id, buildId));
          } catch (err) {
            logger.debug({ err: String(err), buildId }, "build event persist skipped");
          }
        })();
      },
    });

    await db
      .update(build)
      .set({
        status: "done",
        manifest: result.manifest,
        durationMs: result.durationMs,
      })
      .where(eq(build.id, buildId));

    // Onchain game: persist the Arc contract the builder deployed so the bridge
    // can resolve it for sdk.onchain read/write (writes are pinned to it).
    if (result.gameContract) {
      await db
        .update(app)
        .set({
          gameContractAddress: result.gameContract.address,
          gameContractAbi: result.gameContract.abi,
        })
        .where(eq(app.id, appId));
    }

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
  const deployerFor =
    deps.deployerFor ??
    ((b) => createRemoteDeployer({ url: b.endpointUrl, token: b.token }));

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
          /** Object-store keys of attachments uploaded via uploads.create. Image
           *  ones feed Gemini vision; docs are ignored here (they reach the builder). */
          attachmentKeys: z.array(z.string()).max(BUILD_ATTACH_MAX).optional(),
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

        // Resolve attachment bytes from the store and hand them to the refiner as
        // content parts (images → vision, PDF/CSV/text → read natively), so the spec
        // is planned around the file contents. Unreadable types (.xlsx) are skipped
        // here — they still reach the builder agent as URLs from `create`.
        const attachments: { mediaType: string; data: Uint8Array }[] = [];
        if (context.objectStore.configured) {
          for (const key of input.attachmentKeys ?? []) {
            const mediaType = modelMimeOf(key);
            if (!mediaType) continue;
            const data = await context.objectStore.get(key);
            if (data) attachments.push({ mediaType, data });
          }
        }

        try {
          return await runRefine({
            prompt: input.prompt,
            answers: input.answers,
            baseSpec,
            catalog,
            attachments: attachments.length ? attachments : undefined,
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
          /** The marketplace agent the wizard picked (§14). Absent ⇒ auto-route to
           *  a registered eligible agent. Builds are free; the agent just builds. */
          agentId: BuilderAgentId.optional(),
          /** Object-store keys of the user's reference attachments (§17) — all of
           *  them (images + docs) are presigned and handed to the builder agent. */
          attachmentKeys: z.array(z.string()).max(BUILD_ATTACH_MAX).optional(),
          /** The resumable wizard draft this build was dispatched from — linked to
           *  the build on success so it leaves the "pending" feed (§3c). */
          draftId: BuildDraftId.optional(),
        })
      )
      .handler(async ({ context, input }) => {
        // Pick the marketplace builder up front (pure read). Builds are free —
        // there's no payment gate; we just route to a registered agent. There is no
        // house fallback — a build with no eligible agent is rejected below.
        const selected: SelectedBuilder | null = await selectEligibleBuilder(
          context.db,
          input.spec,
          { agentId: input.agentId }
        );

        // No house fallback: every build must route to a registered agent. With
        // the fleet present this only fires for an explicit pick that's unknown or
        // disabled, or an empty registry — reject clearly instead of silently
        // free-building. (Dispatch is not capability-gated; see selectEligibleBuilder.)
        if (!selected) {
          throw new ORPCError("BAD_REQUEST", {
            message: input.agentId
              ? "That builder isn't available."
              : "No builder is available to build this right now.",
          });
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
              agentId: selected.agent.id,
              // Builds are free — no settlement to record.
              paymentTxHash: null,
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

        // Link the source wizard draft to this build → it drops out of the
        // "pending" feed (the build/app now represents it). Owner-scoped, best-effort.
        if (input.draftId) {
          await context.db
            .update(buildDraft)
            .set({ buildId })
            .where(
              and(
                eq(buildDraft.id, input.draftId),
                eq(buildDraft.userId, context.user.id)
              )
            )
            .catch(() => {});
        }

        const buildDeployer = deployerFor(selected);

        // Fire-and-forget; the driver never throws (it records failures on the
        // build row). The web feed polls build.events / status.
        // Presign ALL attachments (images + docs) for the builder agent to fetch.
        const attachmentUrls = presignAll(
          context.objectStore,
          input.attachmentKeys ?? []
        );

        void runBuild(
          context.db,
          context.logger,
          buildDeployer,
          {
            buildId,
            appId: allocated.id,
            spec: input.spec,
            routedAgentId: selected.agent.id,
            attachmentUrls: attachmentUrls.length ? attachmentUrls : undefined,
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

    // The caller's past builds, newest first — powers the /build history list.
    // Per-build step timelines are read on demand via `status` (build.events).
    list: protectedProcedure
      .input(
        z
          .object({ limit: z.number().int().min(1).max(LIST_MAX).default(20) })
          .optional()
      )
      .handler(async ({ context, input }) => {
        const rows = await context.db
          .select({
            id: build.id,
            prompt: build.prompt,
            status: build.status,
            error: build.error,
            durationMs: build.durationMs,
            createdAt: build.createdAt,
            appId: build.appId,
            slug: app.slug,
            appStatus: app.status,
            manifest: build.manifest,
            spec: build.spec,
          })
          .from(build)
          .leftJoin(app, eq(app.id, build.appId))
          .where(eq(build.userId, context.user.id))
          .orderBy(desc(build.createdAt))
          .limit(input?.limit ?? 20);
        return rows.map((r) => ({
          id: r.id,
          prompt: r.prompt,
          status: r.status,
          error: r.error,
          durationMs: r.durationMs,
          createdAt: r.createdAt,
          appId: r.appId,
          slug: r.slug,
          appStatus: r.appStatus,
          name: r.manifest?.name ?? r.spec?.name ?? "Untitled jam",
          iconEmoji: r.manifest?.iconEmoji ?? r.spec?.iconEmoji ?? "✨",
        }));
      }),

    // --- Resumable wizard drafts (§3c) — the make-flow persisted from prompt-start,
    //     so a reload/redirect resumes instead of resetting. Owner-scoped. ---

    /** Upsert the caller's wizard draft (client generates the typeid → stable URL).
     *  Best-effort from the web (debounced, fire-and-forget). The owner guard on the
     *  conflict update makes a foreign id a no-op. */
    saveDraft: protectedProcedure
      .input(
        z.object({
          draftId: BuildDraftId,
          step: BuildStepSchema,
          prompt: z.string().max(2000).default(""),
          spec: AppSpecSchema.nullable().optional(),
          state: DraftStateSchema.default({}),
          buildId: BuildId.nullable().optional(),
        })
      )
      .handler(async ({ context, input }) => {
        await context.db
          .insert(buildDraft)
          .values({
            id: input.draftId,
            userId: context.user.id,
            step: input.step,
            prompt: input.prompt,
            spec: input.spec ?? null,
            state: input.state,
            buildId: input.buildId ?? null,
          })
          .onConflictDoUpdate({
            target: buildDraft.id,
            set: {
              step: input.step,
              prompt: input.prompt,
              spec: input.spec ?? null,
              state: input.state,
              ...(input.buildId ? { buildId: input.buildId } : {}),
              updatedAt: new Date(),
            },
            setWhere: eq(buildDraft.userId, context.user.id),
          });
        // Lazy GC (no cron): drop the caller's abandoned, un-dispatched drafts
        // older than 30 days so the table doesn't grow unbounded. Best-effort.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await context.db
          .delete(buildDraft)
          .where(
            and(
              eq(buildDraft.userId, context.user.id),
              isNull(buildDraft.buildId),
              lt(buildDraft.updatedAt, cutoff)
            )
          )
          .catch(() => {});
        return { ok: true as const };
      }),

    /** Hydrate a draft (cross-device resume). Null if missing or not the caller's. */
    getDraft: protectedProcedure
      .input(z.object({ draftId: BuildDraftId }))
      .handler(async ({ context, input }) => {
        const row = await context.db.query.buildDraft.findFirst({
          where: and(
            eq(buildDraft.id, input.draftId),
            eq(buildDraft.userId, context.user.id)
          ),
        });
        if (!row) return null;
        return {
          id: row.id,
          step: row.step,
          prompt: row.prompt,
          spec: row.spec,
          state: row.state,
          buildId: row.buildId,
          updatedAt: row.updatedAt,
        };
      }),

    /** The caller's PENDING drafts (not yet dispatched) — the top of the /me feed. */
    listDrafts: protectedProcedure.handler(async ({ context }) => {
      const rows = await context.db.query.buildDraft.findMany({
        where: and(
          eq(buildDraft.userId, context.user.id),
          isNull(buildDraft.buildId),
          // Hide blank drafts (no prompt and no spec) — defends the feed against
          // any empty rows that predate the client-side don't-save-empties guard.
          sql`(${buildDraft.prompt} <> '' OR ${buildDraft.spec} IS NOT NULL)`
        ),
        orderBy: [desc(buildDraft.updatedAt)],
        limit: 30,
      });
      return rows.map((r) => ({
        id: r.id,
        step: r.step,
        prompt: r.prompt,
        name: r.spec?.name ?? null,
        iconEmoji: r.spec?.iconEmoji ?? null,
        updatedAt: r.updatedAt,
      }));
    }),

    /** Discard a draft. */
    deleteDraft: protectedProcedure
      .input(z.object({ draftId: BuildDraftId }))
      .handler(async ({ context, input }) => {
        await context.db
          .delete(buildDraft)
          .where(
            and(
              eq(buildDraft.id, input.draftId),
              eq(buildDraft.userId, context.user.id)
            )
          );
        return { ok: true as const };
      }),
  };
};

export const buildsRouter = createBuildsRouter();
