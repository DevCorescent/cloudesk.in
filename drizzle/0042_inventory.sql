CREATE TABLE "inv_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variance_value" bigint DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"hsn" text DEFAULT '' NOT NULL,
	"gst_rate" real DEFAULT 18 NOT NULL,
	"avg_cost" integer DEFAULT 0 NOT NULL,
	"track_batches" boolean DEFAULT false NOT NULL,
	"reorder_level" numeric(14, 3) DEFAULT 0 NOT NULL,
	"reorder_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"supplier_id" uuid,
	"project_id" uuid,
	"variant_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"kind" text NOT NULL,
	"unit_cost" integer DEFAULT 0 NOT NULL,
	"ref_type" text DEFAULT '' NOT NULL,
	"ref_id" uuid,
	"ref_no" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"po_id" uuid,
	"supplier_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"date" date NOT NULL,
	"supplier_invoice" text DEFAULT '' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_po" integer DEFAULT 1 NOT NULL,
	"next_grn" integer DEFAULT 1 NOT NULL,
	"next_transfer" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch" text DEFAULT '' NOT NULL,
	"expiry" date,
	"qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inv_counts" ADD CONSTRAINT "inv_counts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_counts" ADD CONSTRAINT "inv_counts_warehouse_id_inv_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_counts" ADD CONSTRAINT "inv_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_items" ADD CONSTRAINT "inv_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_items" ADD CONSTRAINT "inv_items_supplier_id_inv_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inv_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_items" ADD CONSTRAINT "inv_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_items" ADD CONSTRAINT "inv_items_variant_id_store_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."store_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_moves" ADD CONSTRAINT "inv_moves_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_moves" ADD CONSTRAINT "inv_moves_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_moves" ADD CONSTRAINT "inv_moves_warehouse_id_inv_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_moves" ADD CONSTRAINT "inv_moves_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_purchase_orders" ADD CONSTRAINT "inv_purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_purchase_orders" ADD CONSTRAINT "inv_purchase_orders_supplier_id_inv_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inv_suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_purchase_orders" ADD CONSTRAINT "inv_purchase_orders_warehouse_id_inv_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_purchase_orders" ADD CONSTRAINT "inv_purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_receipts" ADD CONSTRAINT "inv_receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_receipts" ADD CONSTRAINT "inv_receipts_po_id_inv_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."inv_purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_receipts" ADD CONSTRAINT "inv_receipts_supplier_id_inv_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inv_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_receipts" ADD CONSTRAINT "inv_receipts_warehouse_id_inv_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_receipts" ADD CONSTRAINT "inv_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_settings" ADD CONSTRAINT "inv_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_stock" ADD CONSTRAINT "inv_stock_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_stock" ADD CONSTRAINT "inv_stock_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_stock" ADD CONSTRAINT "inv_stock_warehouse_id_inv_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_suppliers" ADD CONSTRAINT "inv_suppliers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_transfers" ADD CONSTRAINT "inv_transfers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_transfers" ADD CONSTRAINT "inv_transfers_from_id_inv_warehouses_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_transfers" ADD CONSTRAINT "inv_transfers_to_id_inv_warehouses_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_transfers" ADD CONSTRAINT "inv_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_warehouses" ADD CONSTRAINT "inv_warehouses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_warehouses" ADD CONSTRAINT "inv_warehouses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_items_org_idx" ON "inv_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_items_variant_uq" ON "inv_items" USING btree ("variant_id") WHERE "inv_items"."variant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inv_items_sku_uq" ON "inv_items" USING btree ("org_id",lower("sku")) WHERE "inv_items"."sku" <> '';--> statement-breakpoint
CREATE INDEX "inv_moves_item_idx" ON "inv_moves" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "inv_moves_org_idx" ON "inv_moves" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_po_number_uq" ON "inv_purchase_orders" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "inv_po_status_idx" ON "inv_purchase_orders" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_grn_number_uq" ON "inv_receipts" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "inv_grn_po_idx" ON "inv_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_stock_uq" ON "inv_stock" USING btree ("item_id","warehouse_id","batch");--> statement-breakpoint
CREATE INDEX "inv_stock_wh_idx" ON "inv_stock" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "inv_suppliers_org_idx" ON "inv_suppliers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_transfer_number_uq" ON "inv_transfers" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "inv_warehouses_org_idx" ON "inv_warehouses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_warehouses_project_uq" ON "inv_warehouses" USING btree ("project_id") WHERE "inv_warehouses"."project_id" is not null;