ALTER TABLE "store_carts" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "exchange_rate" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "base_total" integer;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "currencies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "currency_rates_updated_at" timestamp with time zone;UPDATE "store_orders" SET "base_total" = "total" WHERE "base_total" IS NULL;
