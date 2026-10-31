CREATE TABLE "invoice_counters" (
	"project_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_counters_project_id_fy_pk" PRIMARY KEY("project_id","fy")
);
--> statement-breakpoint
ALTER TABLE "store_carts" ADD COLUMN "buyer_gstin" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_carts" ADD COLUMN "buyer_business_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "buyer_gstin" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "buyer_business_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "hsn" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;