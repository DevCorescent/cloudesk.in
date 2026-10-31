CREATE TABLE "acc_payment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid,
	"number" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid,
	"client_name" text NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"advance" bigint DEFAULT 0 NOT NULL,
	"advance_used" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_tds_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid,
	"date" date NOT NULL,
	"section" text NOT NULL,
	"amount" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"challan_no" text DEFAULT '' NOT NULL,
	"bsr_code" text DEFAULT '' NOT NULL,
	"quarter" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "kind" text DEFAULT 'bill' NOT NULL;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "against_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "tds_section" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "tds_rate" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "tds_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "credited" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "pan" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "tds_section" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "deductee" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "bank" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "acc_payment_runs" ADD CONSTRAINT "acc_payment_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_payment_runs" ADD CONSTRAINT "acc_payment_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_receipts" ADD CONSTRAINT "acc_receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_receipts" ADD CONSTRAINT "acc_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_tds_deposits" ADD CONSTRAINT "acc_tds_deposits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_tds_deposits" ADD CONSTRAINT "acc_tds_deposits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acc_payment_runs_org_idx" ON "acc_payment_runs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "acc_receipts_org_idx" ON "acc_receipts" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "acc_receipts_client_idx" ON "acc_receipts" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "acc_tds_deposits_org_idx" ON "acc_tds_deposits" USING btree ("org_id","quarter");