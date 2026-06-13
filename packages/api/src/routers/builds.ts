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
// The build fee is x402-only (§14): the paid-agent gate verifies the agent was
// paid over x402 (`onchain.verifyUsdcTransfer`, expectedTo = the agent wallet);
// the legacy EIP-3009 receipt path is gone. The deploy dispatch is a DI seam
// (the live builder, M5); `refine` + `deploy` are stubbed in tests.
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
  FREE_BUILDS,
  LIST_MAX,
  REFINE_CALLS_PER_USER_DAY,
  type RefineResult,
  TX_CAP_USDC,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type Address, type Hex } from "viem";
import type { Logger } from "@superjam/logger";
import type { Onchain } from "@superjam/onchain";
import { PUBLIC_CHAIN, formatUsdc, parseUsdc } from "@superjam/onchain";
import {
  type BuildDeployer,
  createRemoteDeployer,
} from "../lib/builder-dispatch.ts";
import { modelMimeOf, presignAll } from "../lib/attachments.ts";
import { isUniqueViolation } from "../lib/db-errors.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
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
  /** Dispatch a spec to a builder + await the deploy result (the house builder). */
  deploy?: BuildDeployer;
  /** Build a deployer for a routed marketplace agent. Tests inject a stub. */
  deployerFor?: DeployerFor;
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
    /** The routed agent's coding model — forwarded to the builder per build. */
    model?: string | null;
    /** Presigned GET URLs for the user's reference attachments (§17) — forwarded
     *  to the builder agent's prompt so it can fetch images/CSV/Excel/PDF. */
    attachmentUrls?: string[];
  },
  /** Passed to finalize for the best-effort ENS mint (§16). Omitted in tests. */
  onchain?: Onchain
): Promise<void> => {
  const { buildId, appId, spec, routedAgentId, model, attachmentUrls } = args;
  try {
    await db.update(build).set({ status: "generating" }).where(eq(build.id, buildId));
    const result = await deploy({
      spec,
      buildId,
      appId,
      model,
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
          /** The marketplace agent the wizard picked (§14). Absent ⇒ auto/house. */
          agentId: BuilderAgentId.optional(),
          /** Proof the build fee was paid: the x402-private fee outcome
           *  `{ via: "x402", txHash }` from `builds.payBuildFee` — `txHash: null`
           *  ⇒ the World free build (verified human × human-backed builder).
           *  Hiring is x402-only; the legacy EIP-3009 receipt path is gone. */
          payment: z
            .object({
              via: z.literal("x402"),
              txHash: z.string().min(1).nullable(),
            })
            .optional(),
          /** Object-store keys of the user's reference attachments (§17) — all of
           *  them (images + docs) are presigned and handed to the builder agent. */
          attachmentKeys: z.array(z.string()).max(BUILD_ATTACH_MAX).optional(),
          /** The resumable wizard draft this build was dispatched from — linked to
           *  the build on success so it leaves the "pending" feed (§3c). */
          draftId: BuildDraftId.optional(),
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

        // The build fee is x402-only: the `builds.payBuildFee` outcome
        // (`txHash: null` ⇒ free). A chosen paid agent settles over x402.
        const x402Pay = input.payment ?? null;

        // Trial quota (platform anti-spam): build #1 is free; past it you must
        // be world-verified OR present a verified USDC receipt (§11). Orthogonal
        // to the agent's price below — worldVerified skips THIS gate, not the fee.
        const prior = await userBuildCount(context.db, context.user.id);
        if (prior >= FREE_BUILDS && !context.user.worldVerified) {
          // Past the free build, a non-verified user must present a real x402
          // settlement (verified in the paid-agent gate below). A null/absent hash
          // is an un-backed "free" claim — the free build requires worldVerified.
          if (!x402Pay?.txHash) {
            throw new ORPCError("FORBIDDEN", {
              message: "Verify you're human (or pay) to keep building.",
            });
          }
        }

        // Paid-to-agent gate (§14) — the "I paid another human's AI" moment. A
        // chosen agent with a price must be paid in USDC to ITS wallet. Verified
        // before dispatch; the txHash is recorded UNIQUE on the build.
        const paidAgent =
          selected && Number(selected.agent.priceUsdc) > 0 ? selected.agent : null;
        if (paidAgent) {
          if (!x402Pay) {
            // No payment at all → must pay (or qualify for the free build, which
            // comes through as an x402 outcome with a null hash from payBuildFee).
            throw new ORPCError("PAYMENT_REQUIRED", {
              message: `Pay ${paidAgent.priceUsdc} USDC to build with ${paidAgent.name}.`,
            });
          }
          if (x402Pay.txHash === null) {
            // Free build — only a verified human hiring a human-backed (AgentBook)
            // builder. Re-checked server-side so a forged "free" claim can't pass.
            if (!(context.user.worldVerified && paidAgent.agentbookRegistered)) {
              throw new ORPCError("PAYMENT_REQUIRED", {
                message: `Pay ${paidAgent.priceUsdc} USDC to build with ${paidAgent.name}.`,
              });
            }
          } else {
            // x402 settles from the Circle Gateway, not the user's wallet — verify
            // the AGENT was paid (≥ price); DON'T assert from == the user's wallet.
            await tryOnchain(() =>
              context.onchain.verifyUsdcTransfer({
                hash: x402Pay.txHash as Hex,
                chain: PUBLIC_CHAIN,
                expectedTo: paidAgent.walletAddress as Address,
                minAmount: parseUsdc(paidAgent.priceUsdc),
              })
            );
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
              // x402 free build ⇒ no hash; otherwise the settlement/receipt hash
              // (the UNIQUE index guards replay for non-null hashes).
              paymentTxHash: paidAgent ? (input.payment?.txHash ?? null) : null,
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

        const buildDeployer = selected ? deployerFor(selected) : deploy;

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
            routedAgentId: selected?.agent.id ?? null,
            model: selected?.agent.model ?? null,
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

    /** Quote hiring a builder (the confirm sheet reads this before Approve): the
     *  builder + price, whether THIS call is free (a verified human hiring a
     *  human-backed AgentBook builder), and the caller's shielded balance +
     *  whether it covers the fee — which drives the top-up prompt (§14/§23). */
    quoteBuilder: protectedProcedure
      .input(z.object({ builderId: BuilderAgentId }))
      .handler(async ({ context, input }) => {
        const agent = await context.db.query.builderAgent.findFirst({
          where: eq(builderAgent.id, input.builderId),
        });
        if (!agent) {
          throw new ORPCError("NOT_FOUND", { message: "Builder not found" });
        }
        const price = parseUsdc(agent.priceUsdc);
        const freeEligible = Boolean(
          context.user.worldVerified && agent.agentbookRegistered
        );
        // Shielded (private-rail) balance — best-effort: any failure shows "—" and
        // treats the balance as 0, so the sheet falls back to the top-up prompt.
        let shielded = parseUsdc("0");
        let shieldedUsdc: string | null = null;
        try {
          shielded = await context.unlink.balance(context.user.id);
          shieldedUsdc = formatUsdc(shielded);
        } catch (err) {
          context.logger.debug(
            { err: String(err) },
            "quoteBuilder: shielded balance unavailable"
          );
        }
        return {
          builder: {
            id: agent.id,
            name: agent.name,
            slug: agent.slug,
            ensName: agent.ensName,
            endpointUrl: agent.endpointUrl,
            displayName: agent.ensName ?? `${agent.slug}.superjam.eth`,
          },
          priceUsdc: agent.priceUsdc,
          free: {
            eligible: freeEligible,
            // The per-N free-trial limit lives at the builder's AgentKit endpoint;
            // we only preview eligibility here (no count to surface yet).
            usesLeft: null as number | null,
            usesTotal: null as number | null,
            reason: freeEligible ? ("worldid" as const) : null,
          },
          balance: {
            shieldedUsdc,
            sufficient: freeEligible || shielded >= price,
          },
        };
      }),

    /** Pay a builder's fee over the x402 PRIVATE rail (the confirm sheet's
     *  Approve). Free for a verified human hiring a human-backed builder (no
     *  settlement); otherwise withdraw-from-shielded → settle the builder's x402
     *  endpoint via Circle Gateway. Returns the settlement hash (null when free).
     *  Gated-live: an unconfigured rail surfaces as PAYMENT_REQUIRED (§3/§23). */
    payBuildFee: protectedProcedure
      .input(z.object({ builderId: BuilderAgentId }))
      .handler(async ({ context, input }) => {
        const agent = await context.db.query.builderAgent.findFirst({
          where: eq(builderAgent.id, input.builderId),
        });
        if (!agent) {
          throw new ORPCError("NOT_FOUND", { message: "Builder not found" });
        }
        const amount = parseUsdc(agent.priceUsdc);
        if (amount > parseUsdc(TX_CAP_USDC)) {
          throw new ORPCError("BAD_REQUEST", { message: "Over the build-fee cap" });
        }
        // Free build: a verified human hiring a human-backed (AgentBook) builder.
        // No settlement — the AgentKit endpoint is the authoritative per-N limiter.
        if (context.user.worldVerified && agent.agentbookRegistered) {
          return { txHash: null as string | null, free: true };
        }
        if (!context.user.unlinkAddress) {
          throw new ORPCError("PAYMENT_REQUIRED", {
            message: "Private payments not provisioned",
          });
        }
        const { hash } = await tryOnchain(() =>
          context.onchain.unlink.payX402({
            fromUnlinkAddress: context.user.unlinkAddress!,
            url: agent.endpointUrl,
            amount,
          })
        );
        return { txHash: hash as string | null, free: false };
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
          isNull(buildDraft.buildId)
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
