CREATE TABLE "acc_einvoices" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"irn" text DEFAULT '' NOT NULL,
	"ack_no" text DEFAULT '' NOT NULL,
	"ack_date" date,
	"transport" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ewb_no" text DEFAULT '' NOT NULL,
	"ewb_date" date,
	"ewb_valid_till" date,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_intercompany" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"from_company_id" uuid NOT NULL,
	"to_company_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_bill_payments" ADD COLUMN "fx_amount" bigint;--> statement-breakpoint
ALTER TABLE "acc_bill_payments" ADD COLUMN "fx_diff" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "fx_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "fx_total" bigint;--> statement-breakpoint
ALTER TABLE "acc_lines" ADD COLUMN "partner_company_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD COLUMN "fx_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "inr_amount" bigint;--> statement-breakpoint
ALTER TABLE "acc_einvoices" ADD CONSTRAINT "acc_einvoices_document_id_invoice_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."invoice_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_einvoices" ADD CONSTRAINT "acc_einvoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_einvoices" ADD CONSTRAINT "acc_einvoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_intercompany" ADD CONSTRAINT "acc_intercompany_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_intercompany" ADD CONSTRAINT "acc_intercompany_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acc_intercompany_org_idx" ON "acc_intercompany" USING btree ("org_id","date");