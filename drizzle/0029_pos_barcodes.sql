ALTER TABLE "store_orders" ADD COLUMN "channel" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "pos" jsonb;--> statement-breakpoint
ALTER TABLE "store_variants" ADD COLUMN "barcode" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "store_variants_barcode_uq" ON "store_variants" USING btree ("project_id","barcode") WHERE "store_variants"."barcode" <> '';