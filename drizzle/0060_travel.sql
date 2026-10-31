CREATE TABLE "hr_card_txns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"merchant" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"claim_id" uuid,
	"repaid_on" date,
	"repaid_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"last4" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"destination" text NOT NULL,
	"international" boolean DEFAULT false NOT NULL,
	"depart_on" date NOT NULL,
	"return_on" date NOT NULL,
	"mode" text DEFAULT 'Flight' NOT NULL,
	"estimate" bigint DEFAULT 0 NOT NULL,
	"advance" bigint DEFAULT 0 NOT NULL,
	"advance_paid_on" date,
	"advance_account_id" uuid,
	"project_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"decided_by" uuid,
	"decision_note" text DEFAULT '' NOT NULL,
	"settled_on" date,
	"settle_account_id" uuid,
	"claimed" bigint DEFAULT 0 NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "kind" text DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "km" real;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "vehicle" text;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "billable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "justification" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "paid_by" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_claims" ADD COLUMN "card_txn_id" uuid;--> statement-breakpoint
ALTER TABLE "work_expenses" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_card_txns" ADD CONSTRAINT "hr_card_txns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_card_txns" ADD CONSTRAINT "hr_card_txns_card_id_hr_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."hr_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_card_txns" ADD CONSTRAINT "hr_card_txns_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_cards" ADD CONSTRAINT "hr_cards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_cards" ADD CONSTRAINT "hr_cards_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_trips" ADD CONSTRAINT "hr_trips_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_trips" ADD CONSTRAINT "hr_trips_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_trips" ADD CONSTRAINT "hr_trips_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_card_txns_fp_uq" ON "hr_card_txns" USING btree ("card_id","fingerprint");--> statement-breakpoint
CREATE INDEX "hr_card_txns_emp_idx" ON "hr_card_txns" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_cards_last4_uq" ON "hr_cards" USING btree ("org_id","last4");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_trips_number_uq" ON "hr_trips" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "hr_trips_emp_idx" ON "hr_trips" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "hr_claims_trip_idx" ON "hr_claims" USING btree ("trip_id");