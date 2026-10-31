CREATE TABLE "acc_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid,
	"month" text NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'office' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"manager_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"pan" text DEFAULT '' NOT NULL,
	"cin" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"base_currency" text DEFAULT 'INR' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_currencies" (
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"decimals" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "org_currencies_org_id_code_pk" PRIMARY KEY("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "org_fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"date" date NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"members" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"company_id" uuid,
	"manager_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "acc_bills" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "acc_journals" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "acc_lines" ADD COLUMN "cost_centre_id" uuid;--> statement-breakpoint
ALTER TABLE "acc_lines" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_books" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_books" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "cost_centre_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_locations" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "inv_warehouses" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "access" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "acc_periods" ADD CONSTRAINT "acc_periods_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_periods" ADD CONSTRAINT "acc_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_branches" ADD CONSTRAINT "org_branches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_branches" ADD CONSTRAINT "org_branches_company_id_org_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."org_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_branches" ADD CONSTRAINT "org_branches_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_companies" ADD CONSTRAINT "org_companies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_currencies" ADD CONSTRAINT "org_currencies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_fx_rates" ADD CONSTRAINT "org_fx_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_fx_rates" ADD CONSTRAINT "org_fx_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_groups" ADD CONSTRAINT "org_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acc_periods_uq" ON "acc_periods" USING btree ("org_id","company_id","month");--> statement-breakpoint
CREATE INDEX "access_reviews_org_idx" ON "access_reviews" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "org_branches_org_idx" ON "org_branches" USING btree ("org_id","company_id");--> statement-breakpoint
CREATE INDEX "org_companies_org_idx" ON "org_companies" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_companies_default_uq" ON "org_companies" USING btree ("org_id") WHERE "org_companies"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "org_fx_rates_uq" ON "org_fx_rates" USING btree ("org_id","currency","date");--> statement-breakpoint
CREATE INDEX "org_groups_org_idx" ON "org_groups" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_code_uq" ON "org_units" USING btree ("org_id","code");