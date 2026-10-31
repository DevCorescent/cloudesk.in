CREATE TABLE "acc_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text DEFAULT 'other' NOT NULL,
	"system_key" text,
	"description" text DEFAULT '' NOT NULL,
	"bank" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"line_id" uuid,
	"fingerprint" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid,
	"supplier_name" text DEFAULT '' NOT NULL,
	"bill_no" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"itc" boolean DEFAULT true NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"receipt_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"source_ref" text DEFAULT '' NOT NULL,
	"party" text DEFAULT '' NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"hash" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reconciled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "acc_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_journal" integer DEFAULT 1 NOT NULL,
	"next_bill" integer DEFAULT 1 NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_accounts" ADD CONSTRAINT "acc_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bank_lines" ADD CONSTRAINT "acc_bank_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bank_lines" ADD CONSTRAINT "acc_bank_lines_account_id_acc_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."acc_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bank_lines" ADD CONSTRAINT "acc_bank_lines_line_id_acc_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."acc_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bill_payments" ADD CONSTRAINT "acc_bill_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bill_payments" ADD CONSTRAINT "acc_bill_payments_bill_id_acc_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."acc_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bill_payments" ADD CONSTRAINT "acc_bill_payments_account_id_acc_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."acc_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD CONSTRAINT "acc_bills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD CONSTRAINT "acc_bills_supplier_id_inv_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inv_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD CONSTRAINT "acc_bills_receipt_id_inv_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inv_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD CONSTRAINT "acc_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_journals" ADD CONSTRAINT "acc_journals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_journals" ADD CONSTRAINT "acc_journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_lines" ADD CONSTRAINT "acc_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_lines" ADD CONSTRAINT "acc_lines_journal_id_acc_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."acc_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_lines" ADD CONSTRAINT "acc_lines_account_id_acc_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."acc_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_settings" ADD CONSTRAINT "acc_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acc_accounts_code_uq" ON "acc_accounts" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_accounts_key_uq" ON "acc_accounts" USING btree ("org_id","system_key") WHERE "acc_accounts"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "acc_bank_lines_account_idx" ON "acc_bank_lines" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_bank_lines_fp_uq" ON "acc_bank_lines" USING btree ("account_id","fingerprint");--> statement-breakpoint
CREATE INDEX "acc_bills_org_idx" ON "acc_bills" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_bills_receipt_uq" ON "acc_bills" USING btree ("receipt_id") WHERE "acc_bills"."receipt_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "acc_journals_source_uq" ON "acc_journals" USING btree ("org_id","source_type","source_id") WHERE "acc_journals"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "acc_journals_date_idx" ON "acc_journals" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "acc_lines_account_idx" ON "acc_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "acc_lines_journal_idx" ON "acc_lines" USING btree ("journal_id");