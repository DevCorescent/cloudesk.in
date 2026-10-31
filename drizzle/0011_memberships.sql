CREATE TABLE "store_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"order_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN "kind" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN "downloads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "kind" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "digital_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "membership_days" integer;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_memberships_email_idx" ON "store_memberships" USING btree ("project_id",lower("email"));