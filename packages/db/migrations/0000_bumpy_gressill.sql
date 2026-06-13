CREATE TYPE "public"."agent_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."app_status" AS ENUM('building', 'deployed', 'listed', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."build_status" AS ENUM('queued', 'generating', 'bundling', 'uploading', 'registering', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('game', 'social', 'tool', 'creative', 'other');--> statement-breakpoint
CREATE TYPE "public"."pot_status" AS ENUM('open', 'resolved', 'void');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ens_name" text,
	"dynamic_user_id" text,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"wallet_address" text,
	"world_verified" boolean DEFAULT false NOT NULL,
	"world_nullifier_hash" text,
	"free_builds_used" integer DEFAULT 0 NOT NULL,
	"unlink_address" text,
	"last_topup_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_dynamic_user_id_unique" UNIQUE("dynamic_user_id"),
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username"),
	CONSTRAINT "user_world_nullifier_hash_unique" UNIQUE("world_nullifier_hash")
);
--> statement-breakpoint
CREATE TABLE "app" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_emoji" text DEFAULT '🟡' NOT NULL,
	"category" "category" DEFAULT 'other' NOT NULL,
	"remix_of_app_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"status" "app_status" DEFAULT 'building' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bundle_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"treasury_address" text,
	"ens_name" text,
	"ens_tx_hash" text,
	"ipfs_cid" text,
	"current_build_id" uuid,
	"built_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "build" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid,
	"user_id" uuid NOT NULL,
	"agent_id" uuid,
	"prompt" text NOT NULL,
	"spec" jsonb,
	"status" "build_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"files" jsonb,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest" jsonb,
	"model" text,
	"duration_ms" integer,
	"cost_usd" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_agent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"endpoint_url" text NOT NULL,
	"token" text NOT NULL,
	"price_usdc" text DEFAULT '0' NOT NULL,
	"wallet_address" text NOT NULL,
	"ens_name" text,
	"builds_count" integer DEFAULT 0 NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builder_agent_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app_counter" (
	"app_id" uuid NOT NULL,
	"counter" varchar(64) NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "app_counter_app_id_counter_key_pk" PRIMARY KEY("app_id","counter","key")
);
--> statement-breakpoint
CREATE TABLE "app_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"collection" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"username" text NOT NULL,
	"world_verified" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_storage" (
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_storage_app_id_user_id_key_pk" PRIMARY KEY("app_id","user_id","key")
);
--> statement-breakpoint
CREATE TABLE "pot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"status" "pot_status" DEFAULT 'open' NOT NULL,
	"resolved_option" text,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pot_stake" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"tx_hash" text NOT NULL,
	"paid_out_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pot_stake_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "publish_payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tx_hash" text NOT NULL,
	"chain_id" integer NOT NULL,
	"amount_usdc" text NOT NULL,
	"status" "publish_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_payment_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "app_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"text" varchar(280),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_review_one_per_human" UNIQUE("app_id","user_id"),
	CONSTRAINT "app_review_rating_range" CHECK ("app_review"."rating" >= 1 AND "app_review"."rating" <= 5)
);
--> statement-breakpoint
CREATE TABLE "app_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"text" varchar(280) NOT NULL,
	"data" jsonb,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_remix_of_app_id_app_id_fk" FOREIGN KEY ("remix_of_app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_built_by_agent_id_builder_agent_id_fk" FOREIGN KEY ("built_by_agent_id") REFERENCES "public"."builder_agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build" ADD CONSTRAINT "build_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build" ADD CONSTRAINT "build_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build" ADD CONSTRAINT "build_agent_id_builder_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."builder_agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_agent" ADD CONSTRAINT "builder_agent_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_counter" ADD CONSTRAINT "app_counter_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_record" ADD CONSTRAINT "app_record_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_record" ADD CONSTRAINT "app_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_storage" ADD CONSTRAINT "app_storage_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_storage" ADD CONSTRAINT "app_storage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot" ADD CONSTRAINT "pot_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot" ADD CONSTRAINT "pot_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_stake" ADD CONSTRAINT "pot_stake_pot_id_pot_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_stake" ADD CONSTRAINT "pot_stake_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_payment" ADD CONSTRAINT "publish_payment_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_payment" ADD CONSTRAINT "publish_payment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_review" ADD CONSTRAINT "app_review_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_review" ADD CONSTRAINT "app_review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_message" ADD CONSTRAINT "app_message_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_message" ADD CONSTRAINT "app_message_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_message" ADD CONSTRAINT "app_message_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_counter_top_idx" ON "app_counter" USING btree ("app_id","counter","value" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "app_record_list_idx" ON "app_record" USING btree ("app_id","collection","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "app_message_inbox_idx" ON "app_message" USING btree ("to_user_id","created_at" DESC NULLS LAST);