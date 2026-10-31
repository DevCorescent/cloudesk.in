CREATE TABLE "bi_dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bi_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"dataset" text NOT NULL,
	"spec" jsonb NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bi_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"hour" integer DEFAULT 9 NOT NULL,
	"weekday" integer DEFAULT 1 NOT NULL,
	"monthday" integer DEFAULT 1 NOT NULL,
	"recipients" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bi_dashboards" ADD CONSTRAINT "bi_dashboards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bi_dashboards" ADD CONSTRAINT "bi_dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bi_reports" ADD CONSTRAINT "bi_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bi_reports" ADD CONSTRAINT "bi_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bi_schedules" ADD CONSTRAINT "bi_schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bi_schedules" ADD CONSTRAINT "bi_schedules_report_id_bi_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."bi_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bi_schedules" ADD CONSTRAINT "bi_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bi_dashboards_org_idx" ON "bi_dashboards" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "bi_reports_org_idx" ON "bi_reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "bi_schedules_due_idx" ON "bi_schedules" USING btree ("active","next_at");