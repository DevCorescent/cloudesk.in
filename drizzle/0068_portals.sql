CREATE TABLE "portal_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"po_id" uuid,
	"invoice_no" text NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"filename" text DEFAULT '' NOT NULL,
	"mime" text DEFAULT '' NOT NULL,
	"bytes" "bytea",
	"status" text DEFAULT 'submitted' NOT NULL,
	"bill_id" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"submitted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inv_purchase_orders" ADD COLUMN "supplier_ack" jsonb;--> statement-breakpoint
ALTER TABLE "inv_purchase_orders" ADD COLUMN "dispatches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_invoices" ADD CONSTRAINT "portal_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invoices" ADD CONSTRAINT "portal_invoices_supplier_id_inv_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inv_suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invoices" ADD CONSTRAINT "portal_invoices_po_id_inv_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."inv_purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invoices" ADD CONSTRAINT "portal_invoices_bill_id_acc_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."acc_bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_invoices_org_idx" ON "portal_invoices" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_invoices_no_uq" ON "portal_invoices" USING btree ("org_id","supplier_id",upper("invoice_no"));--> statement-breakpoint
CREATE UNIQUE INDEX "portal_links_token_uq" ON "portal_links" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_token_uq" ON "portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_sessions_org_idx" ON "portal_sessions" USING btree ("org_id","kind","email");