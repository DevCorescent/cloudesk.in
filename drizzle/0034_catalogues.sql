CREATE TABLE "store_catalogues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"token" text NOT NULL,
	"source" jsonb NOT NULL,
	"design" jsonb NOT NULL,
	"ordering" jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"origin" text DEFAULT 'manual' NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"order_clicks" integer DEFAULT 0 NOT NULL,
	"shares" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_catalogues" ADD CONSTRAINT "store_catalogues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_catalogues" ADD CONSTRAINT "store_catalogues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_catalogues_token_uq" ON "store_catalogues" USING btree ("token");--> statement-breakpoint
CREATE INDEX "store_catalogues_project_idx" ON "store_catalogues" USING btree ("project_id");