CREATE TABLE "clinic_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time" text,
	"minutes" integer DEFAULT 15 NOT NULL,
	"type" text DEFAULT 'consultation' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"token" integer NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"arrived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"date" date NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"paid" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"mrn" text NOT NULL,
	"name" text NOT NULL,
	"dob" date,
	"age_years" integer,
	"gender" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"blood_group" text DEFAULT '' NOT NULL,
	"allergies" text DEFAULT '' NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"emergency_name" text DEFAULT '' NOT NULL,
	"emergency_phone" text DEFAULT '' NOT NULL,
	"consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"account_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"doctor_id" uuid,
	"vitals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"complaints" text DEFAULT '' NOT NULL,
	"findings" text DEFAULT '' NOT NULL,
	"diagnosis" text DEFAULT '' NOT NULL,
	"icd10" text DEFAULT '' NOT NULL,
	"prescription" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"advice" text DEFAULT '' NOT NULL,
	"tests" text DEFAULT '' NOT NULL,
	"follow_up" date,
	"signed_at" timestamp with time zone,
	"addenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_patient_id_clinic_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."clinic_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_bills" ADD CONSTRAINT "clinic_bills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_bills" ADD CONSTRAINT "clinic_bills_patient_id_clinic_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."clinic_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_bills" ADD CONSTRAINT "clinic_bills_visit_id_clinic_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."clinic_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_bills" ADD CONSTRAINT "clinic_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_patients" ADD CONSTRAINT "clinic_patients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_bill_id_clinic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."clinic_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_account_id_acc_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."acc_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_visits" ADD CONSTRAINT "clinic_visits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_visits" ADD CONSTRAINT "clinic_visits_patient_id_clinic_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."clinic_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_visits" ADD CONSTRAINT "clinic_visits_appointment_id_clinic_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."clinic_appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_visits" ADD CONSTRAINT "clinic_visits_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_appointments_token_uq" ON "clinic_appointments" USING btree ("doctor_id","date","token");--> statement-breakpoint
CREATE INDEX "clinic_appointments_day_idx" ON "clinic_appointments" USING btree ("org_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_bills_number_uq" ON "clinic_bills" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_patients_mrn_uq" ON "clinic_patients" USING btree ("org_id","mrn");--> statement-breakpoint
CREATE INDEX "clinic_patients_phone_idx" ON "clinic_patients" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "clinic_visits_patient_idx" ON "clinic_visits" USING btree ("patient_id","created_at");