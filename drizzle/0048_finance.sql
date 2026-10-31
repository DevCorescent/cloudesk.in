CREATE TABLE "acc_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid,
	"branch_id" uuid,
	"cost_centre_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"asset_account_id" uuid NOT NULL,
	"purchase_date" date NOT NULL,
	"in_use_date" date NOT NULL,
	"cost" bigint NOT NULL,
	"residual" bigint DEFAULT 0 NOT NULL,
	"method" text DEFAULT 'slm' NOT NULL,
	"life_months" integer DEFAULT 60 NOT NULL,
	"rate" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disposed_on" date,
	"disposal_amount" bigint,
	"disposal_account_id" uuid,
	"bill_id" uuid,
	"holder_id" uuid,
	"serial" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"year" text NOT NULL,
	"company_id" uuid,
	"cost_centre_id" uuid,
	"amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"every" text DEFAULT 'month' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"auto_reverse" boolean DEFAULT false NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"months" integer DEFAULT 0 NOT NULL,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"cost_centre_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_assets" ADD CONSTRAINT "acc_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_budgets" ADD CONSTRAINT "acc_budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_schedules" ADD CONSTRAINT "acc_schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_schedules" ADD CONSTRAINT "acc_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acc_assets_code_uq" ON "acc_assets" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "acc_assets_org_idx" ON "acc_assets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "acc_budgets_org_idx" ON "acc_budgets" USING btree ("org_id","year");--> statement-breakpoint
CREATE INDEX "acc_schedules_org_idx" ON "acc_schedules" USING btree ("org_id","active");