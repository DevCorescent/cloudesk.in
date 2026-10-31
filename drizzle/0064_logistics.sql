CREATE TABLE "lgx_carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'transporter' NOT NULL,
	"supplier_id" uuid,
	"tracking_url" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgx_drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"employee_id" uuid,
	"licence_no" text DEFAULT '' NOT NULL,
	"licence_expires" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgx_fuel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"date" date NOT NULL,
	"litres" real NOT NULL,
	"amount" bigint NOT NULL,
	"odometer" real NOT NULL,
	"full" boolean DEFAULT true NOT NULL,
	"station" text DEFAULT '' NOT NULL,
	"paid_from_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"from_state" text DEFAULT '' NOT NULL,
	"to_state" text DEFAULT '' NOT NULL,
	"per_kg" bigint DEFAULT 0 NOT NULL,
	"min_charge" bigint DEFAULT 0 NOT NULL,
	"fixed" bigint DEFAULT 0 NOT NULL,
	"volumetric_divisor" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgx_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgx_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"mode" text DEFAULT 'carrier' NOT NULL,
	"carrier_id" uuid,
	"tracking_no" text DEFAULT '' NOT NULL,
	"lr_no" text DEFAULT '' NOT NULL,
	"eway_bill_no" text DEFAULT '' NOT NULL,
	"delivery_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"consignee" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"warehouse_id" uuid,
	"weight_kg" real DEFAULT 0 NOT NULL,
	"packages" integer DEFAULT 1 NOT NULL,
	"dims" jsonb,
	"freight_cost" bigint DEFAULT 0 NOT NULL,
	"freight_billed" bigint DEFAULT 0 NOT NULL,
	"freight_paid_from_id" uuid,
	"freight_paid_on" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"promised_on" date,
	"delivered_at" timestamp with time zone,
	"pod_name" text DEFAULT '' NOT NULL,
	"pod_note" text DEFAULT '' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"track_token" text NOT NULL,
	"trip_id" uuid,
	"stop_order" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgx_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_odo" real,
	"end_odo" real,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expenses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paid_from_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgx_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reg_no" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'van' NOT NULL,
	"ownership" text DEFAULT 'own' NOT NULL,
	"capacity_kg" real DEFAULT 0 NOT NULL,
	"fuel" text DEFAULT 'diesel' NOT NULL,
	"driver_id" uuid,
	"asset_id" uuid,
	"odometer" real,
	"odometer_at" date,
	"docs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lgx_carriers" ADD CONSTRAINT "lgx_carriers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_drivers" ADD CONSTRAINT "lgx_drivers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_fuel" ADD CONSTRAINT "lgx_fuel_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_fuel" ADD CONSTRAINT "lgx_fuel_vehicle_id_lgx_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."lgx_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_fuel" ADD CONSTRAINT "lgx_fuel_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_rates" ADD CONSTRAINT "lgx_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_rates" ADD CONSTRAINT "lgx_rates_carrier_id_lgx_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."lgx_carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_settings" ADD CONSTRAINT "lgx_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_shipments" ADD CONSTRAINT "lgx_shipments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_shipments" ADD CONSTRAINT "lgx_shipments_carrier_id_lgx_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."lgx_carriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_shipments" ADD CONSTRAINT "lgx_shipments_trip_id_lgx_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."lgx_trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_shipments" ADD CONSTRAINT "lgx_shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_trips" ADD CONSTRAINT "lgx_trips_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_trips" ADD CONSTRAINT "lgx_trips_vehicle_id_lgx_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."lgx_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_trips" ADD CONSTRAINT "lgx_trips_driver_id_lgx_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."lgx_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_trips" ADD CONSTRAINT "lgx_trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_vehicles" ADD CONSTRAINT "lgx_vehicles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgx_vehicles" ADD CONSTRAINT "lgx_vehicles_driver_id_lgx_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."lgx_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lgx_carriers_org_idx" ON "lgx_carriers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lgx_drivers_org_idx" ON "lgx_drivers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lgx_fuel_vehicle_idx" ON "lgx_fuel" USING btree ("vehicle_id","odometer");--> statement-breakpoint
CREATE INDEX "lgx_rates_carrier_idx" ON "lgx_rates" USING btree ("carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lgx_shipments_number_uq" ON "lgx_shipments" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "lgx_shipments_track_uq" ON "lgx_shipments" USING btree ("track_token");--> statement-breakpoint
CREATE INDEX "lgx_shipments_org_idx" ON "lgx_shipments" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "lgx_shipments_trip_idx" ON "lgx_shipments" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lgx_trips_number_uq" ON "lgx_trips" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "lgx_trips_vehicle_idx" ON "lgx_trips" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "lgx_vehicles_reg_uq" ON "lgx_vehicles" USING btree ("org_id","reg_no");