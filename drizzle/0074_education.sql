CREATE TABLE "edu_attendance" (
	"org_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"marked_by" uuid,
	CONSTRAINT "edu_attendance_student_id_date_pk" PRIMARY KEY("student_id","date")
);
--> statement-breakpoint
CREATE TABLE "edu_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"year" text NOT NULL,
	"teacher_id" uuid,
	"capacity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edu_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"class_id" uuid NOT NULL,
	"date" date,
	"subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edu_fee_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"year" text NOT NULL,
	"class_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"heads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"installments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gst_rate" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edu_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"student_id" uuid NOT NULL,
	"plan_id" uuid,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"paid" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"waived_reason" text DEFAULT '' NOT NULL,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edu_marks" (
	"exam_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"marks" real,
	CONSTRAINT "edu_marks_exam_id_student_id_subject_pk" PRIMARY KEY("exam_id","student_id","subject")
);
--> statement-breakpoint
CREATE TABLE "edu_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"fee_id" uuid NOT NULL,
	"receipt_no" text NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"account_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edu_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edu_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"admission_no" text NOT NULL,
	"name" text NOT NULL,
	"dob" date,
	"gender" text DEFAULT '' NOT NULL,
	"class_id" uuid,
	"roll_no" integer,
	"guardian_name" text DEFAULT '' NOT NULL,
	"guardian_phone" text DEFAULT '' NOT NULL,
	"guardian_email" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"concession_pct" real DEFAULT 0 NOT NULL,
	"concession_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edu_attendance" ADD CONSTRAINT "edu_attendance_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_attendance" ADD CONSTRAINT "edu_attendance_student_id_edu_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."edu_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_attendance" ADD CONSTRAINT "edu_attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_classes" ADD CONSTRAINT "edu_classes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_classes" ADD CONSTRAINT "edu_classes_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_exams" ADD CONSTRAINT "edu_exams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_exams" ADD CONSTRAINT "edu_exams_class_id_edu_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."edu_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_fee_plans" ADD CONSTRAINT "edu_fee_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_fees" ADD CONSTRAINT "edu_fees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_fees" ADD CONSTRAINT "edu_fees_student_id_edu_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."edu_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_fees" ADD CONSTRAINT "edu_fees_plan_id_edu_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."edu_fee_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_marks" ADD CONSTRAINT "edu_marks_exam_id_edu_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."edu_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_marks" ADD CONSTRAINT "edu_marks_student_id_edu_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."edu_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_payments" ADD CONSTRAINT "edu_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_payments" ADD CONSTRAINT "edu_payments_fee_id_edu_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."edu_fees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_payments" ADD CONSTRAINT "edu_payments_account_id_acc_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."acc_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_payments" ADD CONSTRAINT "edu_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_settings" ADD CONSTRAINT "edu_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_students" ADD CONSTRAINT "edu_students_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edu_students" ADD CONSTRAINT "edu_students_class_id_edu_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."edu_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edu_attendance_org_idx" ON "edu_attendance" USING btree ("org_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "edu_fees_number_uq" ON "edu_fees" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "edu_fees_once_uq" ON "edu_fees" USING btree ("student_id","plan_id","label");--> statement-breakpoint
CREATE INDEX "edu_fees_due_idx" ON "edu_fees" USING btree ("org_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "edu_students_adm_uq" ON "edu_students" USING btree ("org_id","admission_no");--> statement-breakpoint
CREATE INDEX "edu_students_class_idx" ON "edu_students" USING btree ("class_id");