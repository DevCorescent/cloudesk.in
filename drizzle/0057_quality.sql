CREATE TABLE "qc_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"batch" text DEFAULT '' NOT NULL,
	"lot_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"bin_id" uuid,
	"sample_count" integer DEFAULT 1 NOT NULL,
	"source" jsonb NOT NULL,
	"supplier_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"samples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defective" integer DEFAULT 0 NOT NULL,
	"quarantined" numeric(14, 3) DEFAULT 0 NOT NULL,
	"ncr_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"inspected_by" uuid,
	"inspected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_ncrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"source" text DEFAULT 'internal' NOT NULL,
	"inspection_id" uuid,
	"item_id" uuid,
	"supplier_id" uuid,
	"warehouse_id" uuid,
	"batch" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"disposition" text DEFAULT 'pending' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"held" numeric(14, 3) DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"item_id" uuid,
	"category" text DEFAULT '' NOT NULL,
	"stage" text NOT NULL,
	"sample_size" integer DEFAULT 5 NOT NULL,
	"sample_pct" real DEFAULT 0 NOT NULL,
	"accept_max" integer DEFAULT 0 NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_ncrs" ADD CONSTRAINT "qc_ncrs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_ncrs" ADD CONSTRAINT "qc_ncrs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_plans" ADD CONSTRAINT "qc_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_plans" ADD CONSTRAINT "qc_plans_item_id_inv_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inv_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_settings" ADD CONSTRAINT "qc_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qc_inspections_org_idx" ON "qc_inspections" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "qc_ncrs_org_idx" ON "qc_ncrs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "qc_plans_org_idx" ON "qc_plans" USING btree ("org_id","stage");