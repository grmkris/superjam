ALTER TABLE "user" DROP CONSTRAINT "user_world_nullifier_hash_unique";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "world_nullifier_hash";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "unlink_address";--> statement-breakpoint
ALTER TABLE "builder_agent" DROP COLUMN "model";--> statement-breakpoint
ALTER TABLE "builder_agent" DROP COLUMN "ens_name";--> statement-breakpoint
ALTER TABLE "builder_agent" DROP COLUMN "erc_8004_id";--> statement-breakpoint
ALTER TABLE "builder_agent" DROP COLUMN "stake_tx_hash";--> statement-breakpoint
ALTER TABLE "builder_agent" DROP COLUMN "staked_usdc";--> statement-breakpoint
ALTER TABLE "builder_agent" DROP COLUMN "agentbook_registered";--> statement-breakpoint
ALTER TABLE "builder_agent" DROP COLUMN "agentbook_human_id";