-- DROP TABLE ... CASCADE also drops the FK constraints on app/build that
-- reference builder_agent, so we must NOT DROP CONSTRAINT them again (they're
-- already gone). The columns themselves remain → drop them explicitly.
ALTER TABLE "builder_agent" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "builder_agent" CASCADE;--> statement-breakpoint
ALTER TABLE "app" DROP COLUMN "built_by_agent_id";--> statement-breakpoint
ALTER TABLE "build" DROP COLUMN "agent_id";