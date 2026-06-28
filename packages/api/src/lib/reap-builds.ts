// Lazy reaper for orphaned builds (no cron). A build runs via a fire-and-forget
// in-memory poller (builds.ts runBuild); if the server redeploys mid-build that
// poller dies and the build is never marked terminal — the app stays "building"
// ("making…" forever on /me). A live build bumps `build.updatedAt` on every
// progress write, so a non-terminal build whose row has gone quiet is orphaned.
// We mark those failed (best-effort) so the UI shows a terminal "didn't finish".
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import type { BuildStatus, UserId } from "@superjam/shared";
import { and, eq, lt, notInArray } from "drizzle-orm";

const { build } = schema;

/** Builds in these states are terminal — never reaped. */
const TERMINAL: BuildStatus[] = ["done", "failed"];

/**
 * Mark non-terminal builds that haven't been touched in `olderThanMs` as failed.
 * Scope to one user with `userId` (the lazy /me path) or omit for a global sweep
 * (the cleanup script). Best-effort. Returns how many rows were reaped.
 */
export async function reapStaleBuilds(
  db: Database,
  opts: { userId?: UserId; olderThanMs: number }
): Promise<number> {
  const cutoff = new Date(Date.now() - opts.olderThanMs);
  const rows = await db
    .update(build)
    .set({ status: "failed", error: "build interrupted" })
    .where(
      and(
        notInArray(build.status, TERMINAL),
        lt(build.updatedAt, cutoff),
        ...(opts.userId ? [eq(build.userId, opts.userId)] : [])
      )
    )
    .returning({ id: build.id });
  return rows.length;
}
