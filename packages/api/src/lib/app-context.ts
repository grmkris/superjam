// Bridge appId resolution (§12): every bridge call validates the app exists and
// isn't delisted. appId comes from the host's trusted session map, never the
// child message; identity (userId) comes from the session.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import type { AppId } from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

const { app } = schema;
export type App = typeof schema.app.$inferSelect;

export const requireApp = async (db: Database, appId: AppId): Promise<App> => {
  const row = await db.query.app.findFirst({ where: eq(app.id, appId) });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "App not found" });
  }
  if (row.status === "delisted") {
    throw new ORPCError("FORBIDDEN", { message: "App is delisted" });
  }
  return row;
};
