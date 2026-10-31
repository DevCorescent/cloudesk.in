CREATE TABLE "email_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"payload" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"modules" jsonb,
	"limits" jsonb NOT NULL,
	"seats" integer DEFAULT 0 NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"monthly" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"pending" jsonb,
	"credit" integer DEFAULT 0 NOT NULL,
	"complimentary" boolean DEFAULT false NOT NULL,
	"comp_until" timestamp with time zone,
	"reminded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'preset' NOT NULL,
	"modules" jsonb,
	"limits" jsonb NOT NULL,
	"monthly" integer NOT NULL,
	"yearly" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"highlight" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"by_platform" boolean DEFAULT false NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"credit_applied" integer DEFAULT 0 NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"tax_label" text DEFAULT 'GST' NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"paid_via" text,
	"provider_ref" text,
	"payment_ref" text,
	"applies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_otps_email_idx" ON "email_otps" USING btree (lower("email"),"purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_subscriptions_org_uq" ON "org_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_subscriptions_status_idx" ON "org_subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "org_subscriptions_trial_idx" ON "org_subscriptions" USING btree ("trial_ends_at");--> statement-breakpoint
CREATE INDEX "subscription_events_org_idx" ON "subscription_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoices_seq_uq" ON "subscription_invoices" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoices_payment_uq" ON "subscription_invoices" USING btree ("payment_ref");--> statement-breakpoint
CREATE INDEX "subscription_invoices_org_idx" ON "subscription_invoices" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_invoices_status_idx" ON "subscription_invoices" USING btree ("status","due_at");--> statement-breakpoint
-- Every workspace that exists today starts a 30-day trial of everything.
INSERT INTO "org_subscriptions" ("org_id", "plan_id", "plan_name", "modules", "limits", "status", "trial_started_at", "trial_ends_at")
SELECT o."id", 'trial', 'Free trial', NULL, '{"projects":50,"seats":100,"customDomains":25,"automationsPerProject":100}'::jsonb, 'trialing', now(), now() + interval '30 days'
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "org_subscriptions" s WHERE s."org_id" = o."id");
