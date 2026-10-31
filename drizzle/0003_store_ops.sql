CREATE TABLE "store_gift_card_txns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"order_id" uuid,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"initial_value" integer NOT NULL,
	"balance" integer NOT NULL,
	"currency" text NOT NULL,
	"recipient_email" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"secrets" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "status" text DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "provider_id" text;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "store_carts" ADD COLUMN "gift_card_code" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "gift_card_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "gift_card_code" text;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "shipment" jsonb;--> statement-breakpoint
ALTER TABLE "store_variants" ADD COLUMN "low_stock_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_gift_card_txns" ADD CONSTRAINT "store_gift_card_txns_gift_card_id_store_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."store_gift_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_gift_card_txns" ADD CONSTRAINT "store_gift_card_txns_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_gift_cards" ADD CONSTRAINT "store_gift_cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_gift_cards" ADD CONSTRAINT "store_gift_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_integrations" ADD CONSTRAINT "store_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_returns" ADD CONSTRAINT "store_returns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_returns" ADD CONSTRAINT "store_returns_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_gift_card_txns_card_idx" ON "store_gift_card_txns" USING btree ("gift_card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_gift_cards_code_uq" ON "store_gift_cards" USING btree ("project_id",upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "store_integrations_uq" ON "store_integrations" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "store_returns_project_idx" ON "store_returns" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "store_returns_order_idx" ON "store_returns" USING btree ("order_id");