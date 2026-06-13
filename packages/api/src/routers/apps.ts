// apps router (pivot §2/§4) — registers an EXTERNAL, developer/builder-hosted
// mini-app (a Next.js app on Vercel, etc.). The platform no longer hosts a
// bundle: it stores entryUrl + manifest, frames it (apps/web), and mints
// identity tokens (§1). createExternalApp is the shared core the builder's
// terminal "deploy → register" step also calls (it produces an entryUrl, not a
// bundle); registerExternal is the public bring-your-own-URL entry.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import type { Logger } from "@superjam/logger";
import type { Onchain } from "@superjam/onchain";
import {
  type AppId,
  type AppManifest,
  AppManifestSchema,
  type BuildId,
  LIST_MAX,
  PLAYS_COUNTER,
  RESERVED_LABELS,
  type UserId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import type { Address } from "viem";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  protectedProcedure,
  publicProcedure,
  worldVerifiedProcedure,
} from "../orpc.ts";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";

const { app, user, appCounter, appReview, build } = schema;

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
  input: FinalizeExternalAppInput,
  onchain?: Onchain,
  logger?: Logger
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

  // ENS mint (§11 step 5 / §16) — best-effort, AFTER listing. Mints
  // `slug.username.<parent>` under the owner's node + sets the app's url/
  // category/remix records, so the jam is enumerable from ENS alone (the
  // chain-sourced catalog). NEVER fails finalize: a key-less / ENS-down env (or
  // an owner without a wallet) just lists the app un-named. Mirrors the
  // best-effort contract of createAgentIdentity.
  if (onchain) {
    try {
      const owner = await db.query.user.findFirst({
        where: eq(user.id, row.ownerUserId),
        columns: { username: true, walletAddress: true },
      });
      if (owner?.walletAddress) {
        const { ensName, txHash } = await onchain.mintApp({
          slug: row.slug,
          username: owner.username,
          owner: owner.walletAddress as Address,
          records: {
            url: input.entryUrl,
            category: row.category ?? undefined,
            remixOf: row.remixOfAppId ?? undefined,
          },
        });
        const [named] = await db
          .update(app)
          .set({ ensName, ensTxHash: txHash })
          .where(eq(app.id, row.id))
          .returning();
        return named ?? row;
      }
    } catch (err) {
      logger?.warn(
        { err: String(err), appId: row.id },
        "app ENS mint failed (best-effort, app stays listed un-named)"
      );
    }
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
  input: CreateExternalAppInput,
  onchain?: Onchain,
  logger?: Logger
): Promise<typeof schema.app.$inferSelect> => {
  const allocated = await allocateExternalApp(db, {
    manifest: input.manifest,
    ownerUserId: input.ownerUserId,
    buildId: input.buildId,
  });
  return finalizeExternalApp(
    db,
    { appId: allocated.id, entryUrl: input.entryUrl },
    onchain,
    logger
  );
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

  // Discover feed (DESIGN_BRIEF §3b). Lists live jams with the social meta the
  // feed card needs: maker (✓-human), play total, review count, remix lineage.
  // "foryou" = most-played first; "new" = newest. No "friends" tab (no friends
  // graph yet). likes/friendsPlayed are 0 until those surfaces exist.
  explore: publicProcedure
    .input(
      z.object({
        tab: z.enum(["foryou", "new"]).default("foryou"),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(LIST_MAX).default(20),
      })
    )
    .handler(async ({ context, input }) => {
      const db = context.db;
      const offset = decodeCursor(input.cursor);
      const limit = input.limit;

      // play totals (SUM over the _plays counter's per-key rows) + review counts
      const plays = db
        .select({
          appId: appCounter.appId,
          total: sql<string>`coalesce(sum(${appCounter.value}), 0)`.as("total"),
        })
        .from(appCounter)
        .where(eq(appCounter.counter, PLAYS_COUNTER))
        .groupBy(appCounter.appId)
        .as("plays");
      const reviews = db
        .select({
          appId: appReview.appId,
          cnt: sql<number>`count(*)::int`.as("cnt"),
        })
        .from(appReview)
        .groupBy(appReview.appId)
        .as("reviews");
      const remixBase = alias(app, "remix_base");

      const playsTotal = sql<number>`coalesce(${plays.total}, 0)::int`;
      const rows = await db
        .select({
          id: app.id,
          slug: app.slug,
          name: app.name,
          description: app.description,
          iconEmoji: app.iconEmoji,
          category: app.category,
          capabilities: app.capabilities,
          entryUrl: app.entryUrl,
          entryOrigin: app.entryOrigin,
          ensName: app.ensName,
          createdAt: app.createdAt,
          makerUsername: user.username,
          makerVerified: user.worldVerified,
          remixOfName: remixBase.name,
          plays: playsTotal,
          reviewCount: sql<number>`coalesce(${reviews.cnt}, 0)::int`,
        })
        .from(app)
        .innerJoin(user, eq(app.ownerUserId, user.id))
        .leftJoin(plays, eq(plays.appId, app.id))
        .leftJoin(reviews, eq(reviews.appId, app.id))
        .leftJoin(remixBase, eq(app.remixOfAppId, remixBase.id))
        .where(
          and(inArray(app.status, ["listed", "deployed"]), isNotNull(app.entryUrl))
        )
        .orderBy(
          ...(input.tab === "foryou"
            ? [desc(playsTotal), desc(app.createdAt)]
            : [desc(app.createdAt)])
        )
        .limit(limit + 1)
        .offset(offset);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return {
        jams: page.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          iconEmoji: r.iconEmoji,
          category: r.category,
          capabilities: r.capabilities,
          entryUrl: r.entryUrl,
          entryOrigin: r.entryOrigin,
          ensName: r.ensName,
          maker: { username: r.makerUsername, verified: r.makerVerified },
          likes: 0,
          comments: Number(r.reviewCount),
          reviewCount: Number(r.reviewCount),
          plays: Number(r.plays),
          friendsPlayed: 0,
          remixOf: r.remixOfName ? { name: r.remixOfName } : null,
        })),
        cursor: hasMore ? encodeCursor(offset + limit) : undefined,
      };
    }),

  // The caller's own jams (DESIGN_BRIEF §3c-i shelf, §3f /me). Includes
  // in-progress "baking" builds (status 'building' + the live build row) and
  // failed ones — no status filter, unlike the public feed.
  mine: protectedProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(LIST_MAX).default(50) }).optional()
    )
    .handler(async ({ context, input }) => {
      const db = context.db;
      const rows = await db
        .select({
          id: app.id,
          slug: app.slug,
          name: app.name,
          iconEmoji: app.iconEmoji,
          category: app.category,
          status: app.status,
          entryUrl: app.entryUrl,
          buildId: app.currentBuildId,
          buildStatus: build.status,
          createdAt: app.createdAt,
        })
        .from(app)
        .leftJoin(build, eq(app.currentBuildId, build.id))
        .where(eq(app.ownerUserId, context.user.id))
        .orderBy(desc(app.createdAt))
        .limit(input?.limit ?? 50);
      return { jams: rows.map((r) => ({ ...r, buildStatus: r.buildStatus ?? null })) };
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
      const row = await createExternalApp(
        context.db,
        {
          manifest: input.manifest,
          entryUrl: input.entryUrl,
          ownerUserId: context.user.id,
        },
        context.onchain,
        context.logger
      );
      return { id: row.id, slug: row.slug, ensName: row.ensName };
    }),
};
