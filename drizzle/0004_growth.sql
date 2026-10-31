CREATE TABLE "growth_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"section_id" text NOT NULL,
	"title" text NOT NULL,
	"hypothesis" text DEFAULT '' NOT NULL,
	"change" jsonb NOT NULL,
	"metric" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"source" text DEFAULT 'rules' NOT NULL,
	"opportunity_key" text DEFAULT '' NOT NULL,
	"result" jsonb,
	"outcome" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "growth_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"auto_apply_winners" boolean DEFAULT true NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"auto_start" boolean DEFAULT false NOT NULL,
	"dismissed" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "growth_experiments" ADD CONSTRAINT "growth_experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_experiments" ADD CONSTRAINT "growth_experiments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_settings" ADD CONSTRAINT "growth_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "growth_experiments_project_idx" ON "growth_experiments" USING btree ("project_id","status");