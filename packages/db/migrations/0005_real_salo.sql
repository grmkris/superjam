CREATE TABLE "user_delegation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dynamic_user_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"address" text NOT NULL,
	"wallet_api_key" text NOT NULL,
	"key_share" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_delegation_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_delegation_dynamic_user_id_unique" UNIQUE("dynamic_user_id")
);
--> statement-breakpoint
ALTER TABLE "user_delegation" ADD CONSTRAINT "user_delegation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;