CREATE TABLE "build_draft" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"step" text DEFAULT 'home' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"spec" jsonb,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"build_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "build_draft" ADD CONSTRAINT "build_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_draft" ADD CONSTRAINT "build_draft_build_id_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."build"("id") ON DELETE no action ON UPDATE no action;