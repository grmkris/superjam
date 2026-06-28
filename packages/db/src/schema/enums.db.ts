import {
  AGENT_STATUSES,
  APP_STATUSES,
  BUILD_STATUSES,
  CATEGORIES,
  DM_KINDS,
  POT_STATUSES,
  PUBLISH_STATUSES,
} from "@superjam/shared";
import { pgEnum } from "drizzle-orm/pg-core";

export const appStatusEnum = pgEnum("app_status", APP_STATUSES);
export const buildStatusEnum = pgEnum("build_status", BUILD_STATUSES);
export const publishStatusEnum = pgEnum("publish_status", PUBLISH_STATUSES);
export const potStatusEnum = pgEnum("pot_status", POT_STATUSES);
export const agentStatusEnum = pgEnum("agent_status", AGENT_STATUSES);
export const categoryEnum = pgEnum("category", CATEGORIES);
export const dmKindEnum = pgEnum("dm_kind", DM_KINDS);
