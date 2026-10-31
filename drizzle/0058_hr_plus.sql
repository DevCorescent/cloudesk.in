CREATE TABLE "hr_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"employee_id" uuid,
	"anonymous" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"subject" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"action" text DEFAULT 'none' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hr_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"issued_on" date,
	"valid_to" date,
	"link" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_overtime" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"minutes" integer NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_by" uuid,
	"payroll_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department_id" uuid,
	"title" text NOT NULL,
	"planned" integer DEFAULT 1 NOT NULL,
	"budget_ctc" bigint DEFAULT 0 NOT NULL,
	"by_date" date,
	"job_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_roster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid
);
--> statement-breakpoint
CREATE TABLE "hr_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"last_day" date NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"earnings" bigint DEFAULT 0 NOT NULL,
	"recoveries" bigint DEFAULT 0 NOT NULL,
	"net" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"account_id" uuid,
	"paid_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"grace_min" integer DEFAULT 15 NOT NULL,
	"color" text DEFAULT '#2a78d6' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"training_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"due" date,
	"completed_on" date,
	"score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'course' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"hours" real DEFAULT 0 NOT NULL,
	"cost_per_person" bigint DEFAULT 0 NOT NULL,
	"valid_months" integer DEFAULT 0 NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"department_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_cases" ADD CONSTRAINT "hr_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_cases" ADD CONSTRAINT "hr_cases_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_cases" ADD CONSTRAINT "hr_cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_cases" ADD CONSTRAINT "hr_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime" ADD CONSTRAINT "hr_overtime_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime" ADD CONSTRAINT "hr_overtime_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime" ADD CONSTRAINT "hr_overtime_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_roster" ADD CONSTRAINT "hr_roster_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_roster" ADD CONSTRAINT "hr_roster_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_roster" ADD CONSTRAINT "hr_roster_shift_id_hr_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."hr_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settlements" ADD CONSTRAINT "hr_settlements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settlements" ADD CONSTRAINT "hr_settlements_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settlements" ADD CONSTRAINT "hr_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_shifts" ADD CONSTRAINT "hr_shifts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_training_records" ADD CONSTRAINT "hr_training_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_training_records" ADD CONSTRAINT "hr_training_records_training_id_hr_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."hr_trainings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_training_records" ADD CONSTRAINT "hr_training_records_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_trainings" ADD CONSTRAINT "hr_trainings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_cases_org_idx" ON "hr_cases" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "hr_documents_emp_idx" ON "hr_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_documents_org_idx" ON "hr_documents" USING btree ("org_id","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_overtime_uq" ON "hr_overtime" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "hr_overtime_org_idx" ON "hr_overtime" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_roster_uq" ON "hr_roster" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "hr_roster_org_idx" ON "hr_roster" USING btree ("org_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_settlements_emp_uq" ON "hr_settlements" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_shifts_org_idx" ON "hr_shifts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "hr_training_records_idx" ON "hr_training_records" USING btree ("org_id","employee_id");