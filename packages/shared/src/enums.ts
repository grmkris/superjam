// Status enums + build-event shape (§7). One source of truth so the Drizzle
// pgEnums (packages/db) and the zod validators (packages/api) never drift.
import { z } from "zod";

export const APP_STATUSES = [
  "building",
  "deployed",
  "listed",
  "delisted",
] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const BUILD_STATUSES = [
  "queued",
  "generating",
  "bundling",
  "uploading",
  "registering",
  "done",
  "failed",
] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const PUBLISH_STATUSES = ["pending", "confirmed", "rejected"] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

export const POT_STATUSES = ["open", "resolved", "void"] as const;
export type PotStatus = (typeof POT_STATUSES)[number];

export const AGENT_STATUSES = ["active", "disabled"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

// Compact activity-feed event appended to build.events (cap 100, §11 step 3).
export const BUILD_EVENT_KINDS = ["tool", "text", "error", "status"] as const;
export const BuildEventSchema = z.object({
  t: z.number(),
  kind: z.enum(BUILD_EVENT_KINDS),
  label: z.string(),
});
export type BuildEvent = z.infer<typeof BuildEventSchema>;
