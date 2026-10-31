CREATE TABLE "store_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"first_order_id" uuid NOT NULL,
	"email" text NOT NULL,
	"title" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"interval" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"provider_sub_id" text NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"renewals" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "subscription_interval" text;--> statement-breakpoint
ALTER TABLE "store_products" ADD COLUMN "subscription_interval_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_subscriptions_provider_uq" ON "store_subscriptions" USING btree ("provider","provider_sub_id");--> statement-breakpoint
CREATE INDEX "store_subscriptions_project_idx" ON "store_subscriptions" USING btree ("project_id","created_at");