CREATE TYPE "public"."dm_kind" AS ENUM('text', 'card', 'tip');--> statement-breakpoint
CREATE TABLE "friendship" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"via_app_id" uuid,
	"kind" "dm_kind" DEFAULT 'text' NOT NULL,
	"text" varchar(1024),
	"card" jsonb,
	"link" text,
	"amount_usdc" text,
	"tx_hash" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_a_id_user_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_b_id_user_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_via_app_id_app_id_fk" FOREIGN KEY ("via_app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendship_pair_uq" ON "friendship" USING btree ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "friendship_user_a_idx" ON "friendship" USING btree ("user_a_id");--> statement-breakpoint
CREATE INDEX "friendship_user_b_idx" ON "friendship" USING btree ("user_b_id");--> statement-breakpoint
CREATE INDEX "direct_message_to_idx" ON "direct_message" USING btree ("to_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "direct_message_pair_idx" ON "direct_message" USING btree ("from_user_id","to_user_id","created_at" DESC NULLS LAST);