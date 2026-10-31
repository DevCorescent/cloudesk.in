CREATE TABLE "grc_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"auditor_id" uuid,
	"period_from" date,
	"period_to" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_control_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"tested_on" date NOT NULL,
	"result" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"document_id" uuid,
	"tested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"type" text DEFAULT 'preventive' NOT NULL,
	"frequency" text DEFAULT 'quarterly' NOT NULL,
	"next_test_due" date,
	"last_result" text,
	"last_tested_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_esg" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"month" text NOT NULL,
	"metric" text NOT NULL,
	"quantity" real NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"period" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"document_id" uuid,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"reminded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "grc_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"title" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"recommendation" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"response" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"personal_data" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"root_cause" text DEFAULT '' NOT NULL,
	"actions" text DEFAULT '' NOT NULL,
	"risk_id" uuid,
	"reported_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"authority" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"recurrence" jsonb NOT NULL,
	"owner_id" uuid,
	"remind_days" integer DEFAULT 5 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"pack_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"effective_date" date,
	"review_date" date,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_policy_acks" (
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grc_policy_acks_policy_id_version_user_id_pk" PRIMARY KEY("policy_id","version","user_id")
);
--> statement-breakpoint
CREATE TABLE "grc_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'operational' NOT NULL,
	"owner_id" uuid,
	"likelihood" integer NOT NULL,
	"impact" integer NOT NULL,
	"residual_likelihood" integer,
	"residual_impact" integer,
	"treatment" text DEFAULT 'reduce' NOT NULL,
	"plan" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"review_date" date,
	"control_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grc_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grc_audits" ADD CONSTRAINT "grc_audits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_audits" ADD CONSTRAINT "grc_audits_auditor_id_users_id_fk" FOREIGN KEY ("auditor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_control_tests" ADD CONSTRAINT "grc_control_tests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_control_tests" ADD CONSTRAINT "grc_control_tests_control_id_grc_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."grc_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_control_tests" ADD CONSTRAINT "grc_control_tests_document_id_doc_files_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."doc_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_control_tests" ADD CONSTRAINT "grc_control_tests_tested_by_users_id_fk" FOREIGN KEY ("tested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_controls" ADD CONSTRAINT "grc_controls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_controls" ADD CONSTRAINT "grc_controls_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_esg" ADD CONSTRAINT "grc_esg_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_esg" ADD CONSTRAINT "grc_esg_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_filings" ADD CONSTRAINT "grc_filings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_filings" ADD CONSTRAINT "grc_filings_obligation_id_grc_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."grc_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_filings" ADD CONSTRAINT "grc_filings_document_id_doc_files_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."doc_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_filings" ADD CONSTRAINT "grc_filings_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_findings" ADD CONSTRAINT "grc_findings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_findings" ADD CONSTRAINT "grc_findings_audit_id_grc_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."grc_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_findings" ADD CONSTRAINT "grc_findings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_incidents" ADD CONSTRAINT "grc_incidents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_incidents" ADD CONSTRAINT "grc_incidents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_incidents" ADD CONSTRAINT "grc_incidents_risk_id_grc_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."grc_risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_incidents" ADD CONSTRAINT "grc_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_obligations" ADD CONSTRAINT "grc_obligations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_obligations" ADD CONSTRAINT "grc_obligations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_policies" ADD CONSTRAINT "grc_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_policies" ADD CONSTRAINT "grc_policies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_policy_acks" ADD CONSTRAINT "grc_policy_acks_policy_id_grc_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."grc_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_policy_acks" ADD CONSTRAINT "grc_policy_acks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_risks" ADD CONSTRAINT "grc_risks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_risks" ADD CONSTRAINT "grc_risks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_risks" ADD CONSTRAINT "grc_risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grc_settings" ADD CONSTRAINT "grc_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grc_audits_number_uq" ON "grc_audits" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "grc_controls_code_uq" ON "grc_controls" USING btree ("org_id",upper("code"));--> statement-breakpoint
CREATE INDEX "grc_esg_month_idx" ON "grc_esg" USING btree ("org_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "grc_filings_period_uq" ON "grc_filings" USING btree ("obligation_id","period");--> statement-breakpoint
CREATE INDEX "grc_filings_due_idx" ON "grc_filings" USING btree ("org_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "grc_incidents_number_uq" ON "grc_incidents" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "grc_risks_number_uq" ON "grc_risks" USING btree ("org_id","number");