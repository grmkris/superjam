ALTER TABLE "builder_agent" ADD COLUMN "stake_tx_hash" text;--> statement-breakpoint
ALTER TABLE "builder_agent" ADD COLUMN "staked_usdc" text;--> statement-breakpoint
ALTER TABLE "builder_agent" ADD COLUMN "agentbook_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_agent" ADD COLUMN "agentbook_human_id" text;