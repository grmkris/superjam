ALTER TABLE "build" ADD COLUMN "payment_tx_hash" text;--> statement-breakpoint
ALTER TABLE "builder_agent" ADD COLUMN "erc_8004_id" text;--> statement-breakpoint
ALTER TABLE "build" ADD CONSTRAINT "build_payment_tx_hash_unique" UNIQUE("payment_tx_hash");