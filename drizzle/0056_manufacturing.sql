CREATE TABLE "mfg_boms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text DEFAULT 'Standard' NOT NULL,
	"output_qty" numeric(14, 3) DEFAULT 1 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfg_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfg_work_centres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"cost_per_hour" integer DEFAULT 0 NOT NULL,
	"hours_per_day" real DEFAULT 8 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfg_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"item_id" uuid NOT NULL,
	"bom_id" uuid,
	"qty" numeric(14, 3) NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"planned_start" date,
	"planned_end" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"produced" numeric(14, 3) DEFAULT 0 NOT NULL,
	"scrap" numeric(14, 3) DEFAULT 0 NOT NULL,
	"material_cost" bigint DEFAULT 0 NOT NULL,
	"conversion_cost" bigint DEFAULT 0 NOT NULL,
	"unit_cost" integer DEFAULT 0 NOT NULL,
	"sales_order_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mfg_boms" ADD CONSTRAINT "mfg_boms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfg_boms" ADD CONSTRAINT "mfg_boms_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfg_settings" ADD CONSTRAINT "mfg_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfg_work_centres" ADD CONSTRAINT "mfg_work_centres_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfg_work_orders" ADD CONSTRAINT "mfg_work_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfg_work_orders" ADD CONSTRAINT "mfg_work_orders_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfg_work_orders" ADD CONSTRAINT "mfg_work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfg_boms_item_idx" ON "mfg_boms" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mfg_work_centres_code_uq" ON "mfg_work_centres" USING btree ("org_id",lower("code"));--> statement-breakpoint
CREATE INDEX "mfg_work_orders_org_idx" ON "mfg_work_orders" USING btree ("org_id","status");