CREATE TYPE "public"."discount_kind" AS ENUM('percent', 'fixed', 'free_shipping');--> statement-breakpoint
CREATE TYPE "public"."financial_status" AS ENUM('pending', 'paid', 'partially_refunded', 'refunded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('unfulfilled', 'packed', 'shipped', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."shipping_rate_kind" AS ENUM('flat', 'free_over', 'weight', 'pickup');--> statement-breakpoint
CREATE TABLE "store_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address" jsonb,
	"shipping_rate_id" uuid,
	"payment_method" text,
	"discount_code" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"order_id" uuid,
	"recovery_emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"accepts_marketing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "discount_kind" NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"min_subtotal" integer DEFAULT 0 NOT NULL,
	"usage_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"once_per_customer" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_inventory_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"title" text NOT NULL,
	"variant_title" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"unit_price" integer NOT NULL,
	"unit_cost" integer,
	"quantity" integer NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"access_key_hash" text NOT NULL,
	"customer_id" uuid,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"currency" text NOT NULL,
	"subtotal" integer NOT NULL,
	"discount_total" integer DEFAULT 0 NOT NULL,
	"shipping_total" integer DEFAULT 0 NOT NULL,
	"tax_total" integer DEFAULT 0 NOT NULL,
	"fee_total" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"refunded_total" integer DEFAULT 0 NOT NULL,
	"tax_included" boolean NOT NULL,
	"discount_code" text,
	"shipping_method" jsonb,
	"payment_method" text NOT NULL,
	"payment_ref" text,
	"payment_capture_ref" text,
	"financial_status" "financial_status" DEFAULT 'pending' NOT NULL,
	"fulfillment_status" "fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"tracking" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"stock_released" boolean DEFAULT false NOT NULL,
	"reserved_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "store_payment_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"secrets" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_product_collections" (
	"product_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	CONSTRAINT "store_product_collections_product_id_collection_id_pk" PRIMARY KEY("product_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "store_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"tax_bps" integer,
	"featured" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rating" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_shipping_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "shipping_rate_kind" NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"free_over" integer,
	"weight_tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eta" text DEFAULT '' NOT NULL,
	"cod_allowed" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"postal_prefixes" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"country" text NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"rate_bps" integer NOT NULL,
	"name" text DEFAULT 'Tax' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text DEFAULT 'Default' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"compare_at" integer,
	"cost" integer,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"weight_grams" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_webhook_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"address" jsonb,
	"tax_id" text DEFAULT '' NOT NULL,
	"prices_include_tax" boolean DEFAULT true NOT NULL,
	"default_tax_bps" integer DEFAULT 1800 NOT NULL,
	"order_prefix" text DEFAULT '#' NOT NULL,
	"next_order_number" integer DEFAULT 1001 NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checkout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notify_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_carts" ADD CONSTRAINT "store_carts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_collections" ADD CONSTRAINT "store_collections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_customers" ADD CONSTRAINT "store_customers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_discounts" ADD CONSTRAINT "store_discounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_inventory_log" ADD CONSTRAINT "store_inventory_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_inventory_log" ADD CONSTRAINT "store_inventory_log_variant_id_store_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."store_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_inventory_log" ADD CONSTRAINT "store_inventory_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_events" ADD CONSTRAINT "store_order_events_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_events" ADD CONSTRAINT "store_order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_variant_id_store_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."store_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_customer_id_store_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."store_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_payment_providers" ADD CONSTRAINT "store_payment_providers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_collections" ADD CONSTRAINT "store_product_collections_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_collections" ADD CONSTRAINT "store_product_collections_collection_id_store_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."store_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_shipping_rates" ADD CONSTRAINT "store_shipping_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_shipping_rates" ADD CONSTRAINT "store_shipping_rates_zone_id_store_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."store_shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_shipping_zones" ADD CONSTRAINT "store_shipping_zones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_tax_rates" ADD CONSTRAINT "store_tax_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_product_id_store_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_webhook_events" ADD CONSTRAINT "store_webhook_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_carts_token_uq" ON "store_carts" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "store_carts_project_idx" ON "store_carts" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_collections_slug_uq" ON "store_collections" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "store_customers_email_uq" ON "store_customers" USING btree ("project_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "store_discounts_code_uq" ON "store_discounts" USING btree ("project_id",lower("code"));--> statement-breakpoint
CREATE INDEX "store_inventory_log_variant_idx" ON "store_inventory_log" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "store_order_events_order_idx" ON "store_order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "store_order_items_order_idx" ON "store_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_number_uq" ON "store_orders" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "store_orders_project_idx" ON "store_orders" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "store_orders_payment_ref_idx" ON "store_orders" USING btree ("payment_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "store_payment_providers_uq" ON "store_payment_providers" USING btree ("project_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "store_products_slug_uq" ON "store_products" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "store_products_status_idx" ON "store_products" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "store_reviews_product_idx" ON "store_reviews" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "store_variants_product_idx" ON "store_variants" USING btree ("product_id");