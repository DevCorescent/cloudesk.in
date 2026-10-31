ALTER TYPE "public"."org_role" ADD VALUE 'employee';--> statement-breakpoint
CREATE TABLE "hr_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"serial" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'laptop' NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"employee_id" uuid,
	"assigned_at" timestamp with time zone,
	"status" text DEFAULT 'available' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"check_in" timestamp with time zone,
	"check_out" timestamp with time zone,
	"minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'present' NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"stage" text DEFAULT 'applied' NOT NULL,
	"rating" integer DEFAULT 0 NOT NULL,
	"resume_url" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"expected_ctc" bigint,
	"employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"receipt_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payroll_run_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"head_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"emp_no" text NOT NULL,
	"user_id" uuid,
	"horeca_staff_id" uuid,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"personal_email" text DEFAULT '' NOT NULL,
	"dob" date,
	"gender" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"emergency" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"designation" text DEFAULT '' NOT NULL,
	"department_id" uuid,
	"location_id" uuid,
	"manager_id" uuid,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"join_date" date NOT NULL,
	"probation_end" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notice_from" date,
	"exit_date" date,
	"exit_reason" text DEFAULT '' NOT NULL,
	"ctc" bigint DEFAULT 0 NOT NULL,
	"salary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bank" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'on_track' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"location_id" uuid
);
--> statement-breakpoint
CREATE TABLE "hr_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"location_id" uuid,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"openings" integer DEFAULT 1 NOT NULL,
	"salary_range" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"opening" real DEFAULT 0 NOT NULL,
	"adjusted" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"half" text DEFAULT 'none' NOT NULL,
	"days" real NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"quota" real DEFAULT 0 NOT NULL,
	"accrual" text DEFAULT 'yearly' NOT NULL,
	"carry_forward" real DEFAULT 0 NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"allow_half" boolean DEFAULT true NOT NULL,
	"color" text DEFAULT '#2a78d6' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"finalised_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross" bigint DEFAULT 0 NOT NULL,
	"deductions" bigint DEFAULT 0 NOT NULL,
	"net" bigint DEFAULT 0 NOT NULL,
	"hold" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_regularisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"check_in" timestamp with time zone NOT NULL,
	"check_out" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"cycle" text NOT NULL,
	"self_rating" integer,
	"self_note" text DEFAULT '' NOT NULL,
	"manager_rating" integer,
	"manager_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'self' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_emp_no" integer DEFAULT 1 NOT NULL,
	"careers_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_announcements" ADD CONSTRAINT "hr_announcements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_announcements" ADD CONSTRAINT "hr_announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_assets" ADD CONSTRAINT "hr_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_assets" ADD CONSTRAINT "hr_assets_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_job_id_hr_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."hr_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_checklists" ADD CONSTRAINT "hr_checklists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_checklists" ADD CONSTRAINT "hr_checklists_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_payroll_run_id_hr_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."hr_payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD CONSTRAINT "hr_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_holidays" ADD CONSTRAINT "hr_holidays_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_holidays" ADD CONSTRAINT "hr_holidays_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_jobs" ADD CONSTRAINT "hr_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_jobs" ADD CONSTRAINT "hr_jobs_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_jobs" ADD CONSTRAINT "hr_jobs_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_leave_type_id_hr_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."hr_leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_leave_type_id_hr_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."hr_leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_locations" ADD CONSTRAINT "hr_locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_run_id_hr_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hr_payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_regularisations" ADD CONSTRAINT "hr_regularisations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_regularisations" ADD CONSTRAINT "hr_regularisations_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_regularisations" ADD CONSTRAINT "hr_regularisations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_announcements_org_idx" ON "hr_announcements" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "hr_assets_org_idx" ON "hr_assets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_attendance_uq" ON "hr_attendance" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "hr_attendance_org_idx" ON "hr_attendance" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "hr_candidates_job_idx" ON "hr_candidates" USING btree ("job_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_checklists_uq" ON "hr_checklists" USING btree ("employee_id","kind");--> statement-breakpoint
CREATE INDEX "hr_claims_org_idx" ON "hr_claims" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "hr_claims_emp_idx" ON "hr_claims" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_departments_org_idx" ON "hr_departments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_no_uq" ON "hr_employees" USING btree ("org_id","emp_no");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_user_uq" ON "hr_employees" USING btree ("org_id","user_id") WHERE "hr_employees"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "hr_employees_manager_idx" ON "hr_employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "hr_employees_org_idx" ON "hr_employees" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "hr_events_emp_idx" ON "hr_events" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "hr_goals_emp_idx" ON "hr_goals" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_holidays_org_idx" ON "hr_holidays" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "hr_jobs_org_idx" ON "hr_jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_leave_balances_uq" ON "hr_leave_balances" USING btree ("employee_id","leave_type_id","year");--> statement-breakpoint
CREATE INDEX "hr_leave_requests_emp_idx" ON "hr_leave_requests" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE INDEX "hr_leave_requests_org_idx" ON "hr_leave_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "hr_leave_types_org_idx" ON "hr_leave_types" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "hr_locations_org_idx" ON "hr_locations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payroll_runs_month_uq" ON "hr_payroll_runs" USING btree ("org_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payslips_uq" ON "hr_payslips" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_payslips_emp_idx" ON "hr_payslips" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_regularisations_org_idx" ON "hr_regularisations" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_reviews_uq" ON "hr_reviews" USING btree ("employee_id","cycle");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_settings_careers_uq" ON "hr_settings" USING btree ("careers_token");