CREATE TABLE "exec_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"command" text NOT NULL,
	"runtime" text NOT NULL,
	"exit_code" integer NOT NULL,
	"output" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exec_runs" ADD CONSTRAINT "exec_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exec_runs" ADD CONSTRAINT "exec_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exec_runs_project_idx" ON "exec_runs" USING btree ("project_id","created_at");