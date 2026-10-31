CREATE TABLE "inv_purchase_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"category" text NOT NULL,
	"month" text NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"requested_by" uuid,
	"warehouse_id" uuid NOT NULL,
	"needed_by" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"po_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rfq_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_rfq_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_till" date,
	"terms" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"due_date" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supplier_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"award" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"po_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_supplier_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"rate" bigint NOT NULL,
	"min_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"reference" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_supplier_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"receipt_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"date" date NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"debit_note_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inv_settings" ADD COLUMN "counters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "approval" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "checklist" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inv_purchase_budgets" ADD CONSTRAINT "inv_purchase_budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_requisitions" ADD CONSTRAINT "inv_requisitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_requisitions" ADD CONSTRAINT "inv_requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_rfq_quotes" ADD CONSTRAINT "inv_rfq_quotes_rfq_id_inv_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."inv_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_rfqs" ADD CONSTRAINT "inv_rfqs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_rfqs" ADD CONSTRAINT "inv_rfqs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_supplier_rates" ADD CONSTRAINT "inv_supplier_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_supplier_rates" ADD CONSTRAINT "inv_supplier_rates_supplier_id_inv_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inv_suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_supplier_rates" ADD CONSTRAINT "inv_supplier_rates_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_supplier_returns" ADD CONSTRAINT "inv_supplier_returns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_supplier_returns" ADD CONSTRAINT "inv_supplier_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inv_purchase_budgets_uq" ON "inv_purchase_budgets" USING btree ("org_id","category","month");--> statement-breakpoint
CREATE INDEX "inv_requisitions_org_idx" ON "inv_requisitions" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_rfq_quotes_uq" ON "inv_rfq_quotes" USING btree ("rfq_id","supplier_id");--> statement-breakpoint
CREATE INDEX "inv_rfqs_org_idx" ON "inv_rfqs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "inv_supplier_rates_idx" ON "inv_supplier_rates" USING btree ("org_id","supplier_id","item_id");--> statement-breakpoint
CREATE INDEX "inv_supplier_returns_org_idx" ON "inv_supplier_returns" USING btree ("org_id");