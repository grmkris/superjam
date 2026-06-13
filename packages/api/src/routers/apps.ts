// apps router (pivot §2/§4) — registers an EXTERNAL, developer/builder-hosted
// mini-app (a Next.js app on Vercel, etc.). The platform no longer hosts a
// bundle: it stores entryUrl + manifest, frames it (apps/web), and mints
// identity tokens (§1). createExternalApp is the shared core the builder's
// terminal "deploy → register" step also calls (it produces an entryUrl, not a
// bundle); registerExternal is the public bring-your-own-URL entry.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import {
  type AppId,
  type AppManifest,
  AppManifestSchema,
  type BuildId,
  RESERVED_LABELS,
  type UserId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure, worldVerifiedProcedure } from "../orpc.ts";

const { app } = schema;

const isReserved = (slug: string): boolean =>
  (RESERVED_LABELS as readonly string[]).includes(slug);

/** First free slug among base, base-2, base-3, … skipping reserved labels. */
const dedupeSlug = async (db: Database, base: string): Promise<string> => {
  for (let i = 1; ; i += 1) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (isReserved(candidate)) continue;
    const taken = await db
      .select({ id: app.id })
      .from(app)
      .where(eq(app.slug, candidate))
      .limit(1);
    if (taken.length === 0) return candidate;
  }
};

export interface AllocateExternalAppInput {
  manifest: AppManifest;
  ownerUserId: UserId;
  /** Set when a build produced this app (platform-built path). */
  buildId?: BuildId;
}

/**
 * Phase 1 (builder/hosting flow): reserve the app row + appId BEFORE the app is
 * deployed, so the builder can inject SUPERJAM_APP_ID (the token audience) into
 * the app's hosting env at build time — resolving the chicken-and-egg where the
 * deployed app needs its id but the id is created at registration. status stays
 * 'building' (not viewable, apps.get skips it) until finalize attaches the URL.
 */
export const allocateExternalApp = async (
  db: Database,
  input: AllocateExternalAppInput
): Promise<typeof schema.app.$inferSelect> => {
  const { manifest, ownerUserId, buildId } = input;
  const slug = await dedupeSlug(db, manifest.slug);
  const [row] = await db
    .insert(app)
    .values({
      slug,
      name: manifest.name,
      description: manifest.description,
      iconEmoji: manifest.iconEmoji,
      category: manifest.category,
      capabilities: manifest.capabilities,
      ownerUserId,
      currentBuildId: buildId,
      status: "building",
    })
    .returning();
  return row!;
};

export interface FinalizeExternalAppInput {
  appId: AppId;
  entryUrl: string;
}

/**
 * Phase 2 (builder/hosting flow): once the app is deployed, attach its entryUrl
 * (+ derived entryOrigin) and list it. ENS minting (§11 step 5) layers on AFTER
 * and must never fail this — a key-less/ENS-down env still lists the app.
 */
export const finalizeExternalApp = async (
  db: Database,
  input: FinalizeExternalAppInput
): Promise<typeof schema.app.$inferSelect> => {
  const entryOrigin = new URL(input.entryUrl).origin;
  const [row] = await db
    .update(app)
    .set({ entryUrl: input.entryUrl, entryOrigin, status: "listed" })
    .where(eq(app.id, input.appId))
    .returning();
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "App not found" });
  }
  return row;
};

export interface CreateExternalAppInput {
  manifest: AppManifest;
  entryUrl: string;
  ownerUserId: UserId;
  /** Set when a build produced this app (platform-built path). */
  buildId?: BuildId;
}

/**
 * Single-shot allocate + finalize, for the bring-your-own-URL path where the
 * deployed URL is already known (registerExternal). The builder flow uses the
 * two phases separately (allocate → deploy → finalize).
 */
export const createExternalApp = async (
  db: Database,
  input: CreateExternalAppInput
): Promise<typeof schema.app.$inferSelect> => {
  const allocated = await allocateExternalApp(db, {
    manifest: input.manifest,
    ownerUserId: input.ownerUserId,
    buildId: input.buildId,
  });
  return finalizeExternalApp(db, {
    appId: allocated.id,
    entryUrl: input.entryUrl,
  });
};

export const appsRouter = {
  // Public viewer lookup (pivot §3): the host shell resolves a slug to the
  // external entryUrl + capabilities it frames, and the entryOrigin it puts in
  // that page's frame-src CSP. Only live apps are viewable.
  get: publicProcedure
    .input(z.object({ slug: z.string() }))
    .handler(async ({ context, input }) => {
      const row = await context.db.query.app.findFirst({
        where: and(
          eq(app.slug, input.slug),
          inArray(app.status, ["listed", "deployed"])
        ),
      });
      if (!row || !row.entryUrl) {
        throw new ORPCError("NOT_FOUND", { message: "App not found" });
      }
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        iconEmoji: row.iconEmoji,
        category: row.category,
        capabilities: row.capabilities,
        entryUrl: row.entryUrl,
        entryOrigin: row.entryOrigin,
        ensName: row.ensName,
      };
    }),

  // Register a developer-hosted app by URL. Human-gated (worldVerified) — one
  // human = one publisher (§14).
  registerExternal: worldVerifiedProcedure
    .input(
      z.object({
        manifest: AppManifestSchema,
        entryUrl: z.string().url(),
      })
    )
    .handler(async ({ context, input }) => {
      // https only — the iframe is framed under TLS and the app sets cookies
      // Secure (§5 template). Reject plaintext entry points early.
      if (!input.entryUrl.startsWith("https://")) {
        throw new ORPCError("BAD_REQUEST", {
          message: "entryUrl must be https",
        });
      }
      const row = await createExternalApp(context.db, {
        manifest: input.manifest,
        entryUrl: input.entryUrl,
        ownerUserId: context.user.id,
      });
      return { id: row.id, slug: row.slug, ensName: row.ensName };
    }),
};
