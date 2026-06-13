// builds router (§11) — the front door to the build pipeline. Stage 0 is
// `refine` (idea → AppSpec): protected, does NOT consume the free build, capped
// at REFINE_CALLS_PER_USER_DAY. The refiner runs PLATFORM-side (Gemini via the
// AI SDK, @superjam/builder) so the wizard stays alive when the builder box is
// busy/down. `refine` is a constructor DEP (a code seam, not an env flag) so
// tests stub it with a canned AppSpec — no live key, no network.
//
// builds.create (Stage 1+, the trial-quota'd build dispatch) lands with the
// apps/builder service. Until router.ts wires `builds: buildsRouter`, this file
// typechecks + tests standalone (assembly is the integrator's append-only lane).
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppSpec,
  AppId,
  LIST_MAX,
  REFINE_CALLS_PER_USER_DAY,
  type RefineResult,
} from "@superjam/shared";
import {
  type RefineCatalogApp,
  type RefineInput,
  refine as defaultRefine,
} from "@superjam/builder";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../orpc.ts";

const { app, build } = schema;

/** The refine seam: production = Gemini; tests inject a canned result. */
export type RefineFn = (input: RefineInput) => Promise<RefineResult>;

export interface BuildsRouterDeps {
  refine?: RefineFn;
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

export const createBuildsRouter = (deps: BuildsRouterDeps = {}) => {
  const runRefine = deps.refine ?? defaultRefine;

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
  };
};

export const buildsRouter = createBuildsRouter();
