CREATE TABLE "work_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rate" bigint,
	"cost_rate" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "work_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"amount" bigint DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"invoice_id" uuid,
	"position" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"client_id" uuid,
	"client_name" text DEFAULT '' NOT NULL,
	"deal_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"billing" text DEFAULT 'hourly' NOT NULL,
	"rate" bigint DEFAULT 0 NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"budget_hours" real DEFAULT 0 NOT NULL,
	"budget_amount" bigint DEFAULT 0 NOT NULL,
	"start_date" date,
	"due_date" date,
	"lead_id" uuid,
	"tint" text DEFAULT 'sky' NOT NULL,
	"next_task" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_project" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"milestone_id" uuid,
	"parent_id" uuid,
	"start_date" date,
	"due_date" date,
	"estimate_hours" real DEFAULT 0 NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_time" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"timer_started_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"decided_by" uuid,
	"decision_note" text DEFAULT '' NOT NULL,
	"invoice_id" uuid,
	"billed_rate" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_comments" ADD CONSTRAINT "work_comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_comments" ADD CONSTRAINT "work_comments_task_id_work_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."work_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_comments" ADD CONSTRAINT "work_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_members" ADD CONSTRAINT "work_members_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_members" ADD CONSTRAINT "work_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_milestones" ADD CONSTRAINT "work_milestones_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_milestones" ADD CONSTRAINT "work_milestones_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_projects" ADD CONSTRAINT "work_projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_projects" ADD CONSTRAINT "work_projects_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_projects" ADD CONSTRAINT "work_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_settings" ADD CONSTRAINT "work_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_milestone_id_work_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."work_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_time" ADD CONSTRAINT "work_time_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_time" ADD CONSTRAINT "work_time_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_time" ADD CONSTRAINT "work_time_task_id_work_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."work_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_time" ADD CONSTRAINT "work_time_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_time" ADD CONSTRAINT "work_time_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_comments_task_idx" ON "work_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "work_members_user_idx" ON "work_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_milestones_project_idx" ON "work_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_projects_code_uq" ON "work_projects" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "work_projects_org_idx" ON "work_projects" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_tasks_number_uq" ON "work_tasks" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "work_tasks_board_idx" ON "work_tasks" USING btree ("project_id","status","position");--> statement-breakpoint
CREATE INDEX "work_tasks_assignee_idx" ON "work_tasks" USING btree ("org_id","assignee_id","status");--> statement-breakpoint
CREATE INDEX "work_time_user_idx" ON "work_time" USING btree ("org_id","user_id","date");--> statement-breakpoint
CREATE INDEX "work_time_project_idx" ON "work_time" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "work_time_invoice_idx" ON "work_time" USING btree ("invoice_id");