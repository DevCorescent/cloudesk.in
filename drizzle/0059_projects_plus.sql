CREATE TABLE "work_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"hours_per_day" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"hours" real DEFAULT 0 NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"markup_pct" real DEFAULT 0 NOT NULL,
	"receipt_link" text DEFAULT '' NOT NULL,
	"invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text DEFAULT 'risk' NOT NULL,
	"title" text NOT NULL,
	"probability" integer DEFAULT 3 NOT NULL,
	"impact" integer DEFAULT 3 NOT NULL,
	"owner_id" uuid,
	"mitigation" text DEFAULT '' NOT NULL,
	"due" date,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"type" text DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_allocations" ADD CONSTRAINT "work_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_changes" ADD CONSTRAINT "work_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_changes" ADD CONSTRAINT "work_changes_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_changes" ADD CONSTRAINT "work_changes_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_docs" ADD CONSTRAINT "work_docs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_docs" ADD CONSTRAINT "work_docs_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_docs" ADD CONSTRAINT "work_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_expenses" ADD CONSTRAINT "work_expenses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_expenses" ADD CONSTRAINT "work_expenses_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_expenses" ADD CONSTRAINT "work_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_risks" ADD CONSTRAINT "work_risks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_risks" ADD CONSTRAINT "work_risks_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_risks" ADD CONSTRAINT "work_risks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_links" ADD CONSTRAINT "work_task_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_links" ADD CONSTRAINT "work_task_links_project_id_work_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_links" ADD CONSTRAINT "work_task_links_from_id_work_tasks_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."work_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_links" ADD CONSTRAINT "work_task_links_to_id_work_tasks_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."work_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_allocations_user_idx" ON "work_allocations" USING btree ("org_id","user_id","from_date");--> statement-breakpoint
CREATE INDEX "work_allocations_project_idx" ON "work_allocations" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_changes_number_uq" ON "work_changes" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "work_docs_project_idx" ON "work_docs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_expenses_project_idx" ON "work_expenses" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "work_expenses_invoice_idx" ON "work_expenses" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "work_risks_project_idx" ON "work_risks" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_task_links_uq" ON "work_task_links" USING btree ("from_id","to_id");--> statement-breakpoint
CREATE INDEX "work_task_links_project_idx" ON "work_task_links" USING btree ("project_id");