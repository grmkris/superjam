CREATE TABLE "app_like" (
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_like_app_id_user_id_pk" PRIMARY KEY("app_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "app_like" ADD CONSTRAINT "app_like_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_like" ADD CONSTRAINT "app_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_like_user_idx" ON "app_like" USING btree ("user_id");