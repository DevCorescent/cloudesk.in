CREATE TABLE "mnt_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"parent_id" uuid,
	"make" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"serial" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"criticality" text DEFAULT 'medium' NOT NULL,
	"custodian_id" uuid,
	"fixed_asset_id" uuid,
	"purchase_date" date,
	"warranty_until" date,
	"meter_unit" text DEFAULT '' NOT NULL,
	"meter" real,
	"meter_at" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mnt_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text DEFAULT 'amc' NOT NULL,
	"vendor" text NOT NULL,
	"supplier_id" uuid,
	"reference" text DEFAULT '' NOT NULL,
	"asset_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mnt_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"plan_id" uuid,
	"kind" text DEFAULT 'breakdown' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"requested_by" uuid,
	"assignee_id" uuid,
	"due_date" date,
	"down_from" timestamp with time zone,
	"down_to" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labour" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parts_cost" bigint DEFAULT 0 NOT NULL,
	"external_cost" bigint DEFAULT 0 NOT NULL,
	"external_note" text DEFAULT '' NOT NULL,
	"failure" text DEFAULT '' NOT NULL,
	"cause" text DEFAULT '' NOT NULL,
	"remedy" text DEFAULT '' NOT NULL,
	"meter_at_done" real,
	"warehouse_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mnt_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"every_days" integer,
	"every_meter" real,
	"start_on" date NOT NULL,
	"start_meter" real DEFAULT 0 NOT NULL,
	"lead_days" integer DEFAULT 7 NOT NULL,
	"lead_meter" real DEFAULT 0 NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimate_hours" real DEFAULT 0 NOT NULL,
	"assignee_id" uuid,
	"last_done_on" date,
	"last_done_meter" real,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mnt_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"value" real NOT NULL,
	"on" date NOT NULL,
	"by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mnt_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mnt_assets" ADD CONSTRAINT "mnt_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_assets" ADD CONSTRAINT "mnt_assets_custodian_id_users_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_contracts" ADD CONSTRAINT "mnt_contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_orders" ADD CONSTRAINT "mnt_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_orders" ADD CONSTRAINT "mnt_orders_asset_id_mnt_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."mnt_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_orders" ADD CONSTRAINT "mnt_orders_plan_id_mnt_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."mnt_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_orders" ADD CONSTRAINT "mnt_orders_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_orders" ADD CONSTRAINT "mnt_orders_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_plans" ADD CONSTRAINT "mnt_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_plans" ADD CONSTRAINT "mnt_plans_asset_id_mnt_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."mnt_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_plans" ADD CONSTRAINT "mnt_plans_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_readings" ADD CONSTRAINT "mnt_readings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_readings" ADD CONSTRAINT "mnt_readings_asset_id_mnt_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."mnt_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_readings" ADD CONSTRAINT "mnt_readings_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mnt_settings" ADD CONSTRAINT "mnt_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mnt_assets_code_uq" ON "mnt_assets" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "mnt_assets_org_idx" ON "mnt_assets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "mnt_contracts_org_idx" ON "mnt_contracts" USING btree ("org_id","end_on");--> statement-breakpoint
CREATE UNIQUE INDEX "mnt_orders_number_uq" ON "mnt_orders" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "mnt_orders_asset_idx" ON "mnt_orders" USING btree ("asset_id","status");--> statement-breakpoint
CREATE INDEX "mnt_orders_org_idx" ON "mnt_orders" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "mnt_plans_asset_idx" ON "mnt_plans" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "mnt_readings_asset_idx" ON "mnt_readings" USING btree ("asset_id","on");