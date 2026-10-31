CREATE TABLE "partner_clicks" (
	"partner_id" uuid NOT NULL,
	"code" text NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "partner_clicks_partner_id_code_campaign_day_pk" PRIMARY KEY("partner_id","code","campaign","day")
);
--> statement-breakpoint
CREATE TABLE "partner_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"referral_id" uuid,
	"org_id" uuid,
	"invoice_id" uuid,
	"kind" text DEFAULT 'invoice' NOT NULL,
	"basis" integer DEFAULT 0 NOT NULL,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'earned' NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"primary" boolean DEFAULT false NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"discount_payments" integer DEFAULT 1 NOT NULL,
	"commission_bps" integer,
	"active" boolean DEFAULT true NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"company" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"org_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"tds" integer DEFAULT 0 NOT NULL,
	"net" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"admin_note" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"coupon_id" uuid,
	"code" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"discount_left" integer DEFAULT 0 NOT NULL,
	"commission_bps" integer,
	"commission_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payout_method" text,
	"payout_enc" text,
	"payout_hint" text DEFAULT '' NOT NULL,
	"commission_bps" integer,
	"commission_months" integer,
	"review_note" text DEFAULT '' NOT NULL,
	"admin_note" text DEFAULT '' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_clicks" ADD CONSTRAINT "partner_clicks_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_referral_id_partner_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."partner_referrals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_invoice_id_subscription_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."subscription_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_coupons" ADD CONSTRAINT "partner_coupons_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_coupons" ADD CONSTRAINT "partner_coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_leads" ADD CONSTRAINT "partner_leads_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_leads" ADD CONSTRAINT "partner_leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_coupon_id_partner_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."partner_coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_commissions_invoice_uq" ON "partner_commissions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "partner_commissions_partner_idx" ON "partner_commissions" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_coupons_code_uq" ON "partner_coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "partner_coupons_partner_idx" ON "partner_coupons" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_leads_partner_idx" ON "partner_leads" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_leads_email_idx" ON "partner_leads" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payouts_seq_uq" ON "partner_payouts" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "partner_payouts_partner_idx" ON "partner_payouts" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_payouts_status_idx" ON "partner_payouts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_referrals_org_uq" ON "partner_referrals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "partner_referrals_partner_idx" ON "partner_referrals" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_user_uq" ON "partners" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_code_uq" ON "partners" USING btree ("code");--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status","created_at");