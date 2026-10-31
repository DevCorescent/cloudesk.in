CREATE TABLE "con_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"up_to" date NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross" bigint NOT NULL,
	"retention" bigint NOT NULL,
	"advance" bigint NOT NULL,
	"gst" bigint NOT NULL,
	"tds" bigint NOT NULL,
	"net" bigint NOT NULL,
	"received" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"certified_on" date,
	"client_ref" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "con_boq" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"qty" real NOT NULL,
	"rate" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "con_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"client" text NOT NULL,
	"client_gstin" text DEFAULT '' NOT NULL,
	"work_order_no" text DEFAULT '' NOT NULL,
	"site" text DEFAULT '' NOT NULL,
	"start_date" date,
	"end_date" date,
	"retention_pct" real DEFAULT 5 NOT NULL,
	"advance_pct" real DEFAULT 10 NOT NULL,
	"gst_rate" real DEFAULT 18 NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"tds_pct" real DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "con_diary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"date" date NOT NULL,
	"weather" text DEFAULT '' NOT NULL,
	"labour" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work" text NOT NULL,
	"hindrances" text DEFAULT '' NOT NULL,
	"visitors" text DEFAULT '' NOT NULL,
	"by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "con_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"nos" real DEFAULT 1 NOT NULL,
	"length" real,
	"breadth" real,
	"depth" real,
	"qty" real NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"bill_id" uuid,
	"recorded_by" uuid,
	"checked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "con_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bill_id" uuid,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"account_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "con_bills" ADD CONSTRAINT "con_bills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_bills" ADD CONSTRAINT "con_bills_contract_id_con_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."con_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_bills" ADD CONSTRAINT "con_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_boq" ADD CONSTRAINT "con_boq_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_boq" ADD CONSTRAINT "con_boq_contract_id_con_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."con_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_contracts" ADD CONSTRAINT "con_contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_diary" ADD CONSTRAINT "con_diary_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_diary" ADD CONSTRAINT "con_diary_contract_id_con_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."con_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_diary" ADD CONSTRAINT "con_diary_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_measurements" ADD CONSTRAINT "con_measurements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_measurements" ADD CONSTRAINT "con_measurements_contract_id_con_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."con_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_measurements" ADD CONSTRAINT "con_measurements_item_id_con_boq_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."con_boq"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_measurements" ADD CONSTRAINT "con_measurements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_measurements" ADD CONSTRAINT "con_measurements_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_payments" ADD CONSTRAINT "con_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_payments" ADD CONSTRAINT "con_payments_contract_id_con_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."con_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_payments" ADD CONSTRAINT "con_payments_bill_id_con_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."con_bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_payments" ADD CONSTRAINT "con_payments_account_id_acc_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."acc_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "con_payments" ADD CONSTRAINT "con_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "con_bills_seq_uq" ON "con_bills" USING btree ("contract_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "con_boq_code_uq" ON "con_boq" USING btree ("contract_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "con_diary_day_uq" ON "con_diary" USING btree ("contract_id","date");--> statement-breakpoint
CREATE INDEX "con_measurements_item_idx" ON "con_measurements" USING btree ("item_id","date");