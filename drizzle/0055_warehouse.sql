CREATE TABLE "inv_bin_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_bins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"zone" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'storage' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"line_id" text DEFAULT '' NOT NULL,
	"ref_no" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_serials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"warehouse_id" uuid,
	"received_ref" jsonb,
	"last_ref" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_waves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'picking' NOT NULL,
	"order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"packages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inv_items" ADD COLUMN "safety_stock" numeric(14, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_items" ADD COLUMN "track_serials" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_bin_stock" ADD CONSTRAINT "inv_bin_stock_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_bin_stock" ADD CONSTRAINT "inv_bin_stock_bin_id_inv_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."inv_bins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_bin_stock" ADD CONSTRAINT "inv_bin_stock_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_bins" ADD CONSTRAINT "inv_bins_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_bins" ADD CONSTRAINT "inv_bins_warehouse_id_inv_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."inv_warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_reservations" ADD CONSTRAINT "inv_reservations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_reservations" ADD CONSTRAINT "inv_reservations_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_serials" ADD CONSTRAINT "inv_serials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_serials" ADD CONSTRAINT "inv_serials_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_waves" ADD CONSTRAINT "inv_waves_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_waves" ADD CONSTRAINT "inv_waves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inv_bin_stock_uq" ON "inv_bin_stock" USING btree ("bin_id","item_id","batch");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_bins_code_uq" ON "inv_bins" USING btree ("warehouse_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "inv_reservations_uq" ON "inv_reservations" USING btree ("ref_type","ref_id","line_id");--> statement-breakpoint
CREATE INDEX "inv_reservations_item_idx" ON "inv_reservations" USING btree ("org_id","item_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_serials_uq" ON "inv_serials" USING btree ("item_id",lower("serial"));--> statement-breakpoint
CREATE INDEX "inv_serials_org_idx" ON "inv_serials" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "inv_waves_org_idx" ON "inv_waves" USING btree ("org_id","status");