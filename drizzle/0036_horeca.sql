CREATE TABLE "horeca_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_bar_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_bar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"bottle_ml" integer DEFAULT 750 NOT NULL,
	"cost_per_bottle" integer DEFAULT 0 NOT NULL,
	"stock_ml" integer DEFAULT 0 NOT NULL,
	"reorder_ml" integer DEFAULT 750 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_bar_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"bar_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ml" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"order_item_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"station" text DEFAULT 'kitchen' NOT NULL,
	"available_from" text DEFAULT '' NOT NULL,
	"available_to" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"diet" text DEFAULT 'veg' NOT NULL,
	"spice" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"prep_minutes" integer DEFAULT 15 NOT NULL,
	"tax_bps" integer,
	"modifier_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bar_item_id" uuid,
	"pour_ml" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"station" text DEFAULT 'kitchen' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"kot_no" integer,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"bar_item_id" uuid,
	"pour_ml" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"table_id" uuid,
	"room_booking_id" uuid,
	"source" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"guest_name" text DEFAULT '' NOT NULL,
	"guest_phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"access_key_hash" text,
	"discount" integer DEFAULT 0 NOT NULL,
	"service_charge_bps" integer DEFAULT 0 NOT NULL,
	"tip" integer DEFAULT 0 NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"billed_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "horeca_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "horeca_room_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"guest_name" text NOT NULL,
	"guest_phone" text DEFAULT '' NOT NULL,
	"guest_email" text DEFAULT '' NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"adults" integer DEFAULT 2 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"rate" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"charges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_room_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rate" integer NOT NULL,
	"max_guests" integer DEFAULT 2 NOT NULL,
	"amenities" text[] DEFAULT '{}'::text[] NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"number" text NOT NULL,
	"floor" text DEFAULT '' NOT NULL,
	"housekeeping" text DEFAULT 'clean' NOT NULL,
	"table_id" uuid
);
--> statement-breakpoint
CREATE TABLE "horeca_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"area_id" uuid,
	"name" text NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"kind" text DEFAULT 'table' NOT NULL,
	"token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_valet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ticket" integer NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'parked' NOT NULL,
	"plate" text DEFAULT '' NOT NULL,
	"car" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"guest_name" text DEFAULT '' NOT NULL,
	"guest_phone" text DEFAULT '' NOT NULL,
	"slot" text DEFAULT '' NOT NULL,
	"key_tag" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"table_id" uuid,
	"room_booking_id" uuid,
	"expected_at" timestamp with time zone,
	"parked_at" timestamp with time zone,
	"requested_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_venues" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'restaurant' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"tax_bps" integer DEFAULT 500 NOT NULL,
	"service_charge_bps" integer DEFAULT 0 NOT NULL,
	"token" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_order_no" integer DEFAULT 1 NOT NULL,
	"next_kot_no" integer DEFAULT 1 NOT NULL,
	"next_valet_no" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "horeca_areas" ADD CONSTRAINT "horeca_areas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_bar_counts" ADD CONSTRAINT "horeca_bar_counts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_bar_counts" ADD CONSTRAINT "horeca_bar_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_bar_items" ADD CONSTRAINT "horeca_bar_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_bar_moves" ADD CONSTRAINT "horeca_bar_moves_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_bar_moves" ADD CONSTRAINT "horeca_bar_moves_bar_item_id_horeca_bar_items_id_fk" FOREIGN KEY ("bar_item_id") REFERENCES "public"."horeca_bar_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_bar_moves" ADD CONSTRAINT "horeca_bar_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_categories" ADD CONSTRAINT "horeca_categories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_items" ADD CONSTRAINT "horeca_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_items" ADD CONSTRAINT "horeca_items_category_id_horeca_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."horeca_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_modifier_groups" ADD CONSTRAINT "horeca_modifier_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_order_items" ADD CONSTRAINT "horeca_order_items_order_id_horeca_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."horeca_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_order_items" ADD CONSTRAINT "horeca_order_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD CONSTRAINT "horeca_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD CONSTRAINT "horeca_orders_table_id_horeca_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."horeca_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_requests" ADD CONSTRAINT "horeca_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_requests" ADD CONSTRAINT "horeca_requests_table_id_horeca_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."horeca_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_room_bookings" ADD CONSTRAINT "horeca_room_bookings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_room_bookings" ADD CONSTRAINT "horeca_room_bookings_room_id_horeca_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."horeca_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_room_types" ADD CONSTRAINT "horeca_room_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_rooms" ADD CONSTRAINT "horeca_rooms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_rooms" ADD CONSTRAINT "horeca_rooms_type_id_horeca_room_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."horeca_room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_rooms" ADD CONSTRAINT "horeca_rooms_table_id_horeca_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."horeca_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_tables" ADD CONSTRAINT "horeca_tables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_tables" ADD CONSTRAINT "horeca_tables_area_id_horeca_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."horeca_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_valet" ADD CONSTRAINT "horeca_valet_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_valet" ADD CONSTRAINT "horeca_valet_table_id_horeca_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."horeca_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_valet" ADD CONSTRAINT "horeca_valet_room_booking_id_horeca_room_bookings_id_fk" FOREIGN KEY ("room_booking_id") REFERENCES "public"."horeca_room_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_venues" ADD CONSTRAINT "horeca_venues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "horeca_areas_project_idx" ON "horeca_areas" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "horeca_bar_counts_project_idx" ON "horeca_bar_counts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "horeca_bar_items_project_idx" ON "horeca_bar_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "horeca_bar_moves_item_idx" ON "horeca_bar_moves" USING btree ("bar_item_id","created_at");--> statement-breakpoint
CREATE INDEX "horeca_categories_project_idx" ON "horeca_categories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "horeca_items_project_idx" ON "horeca_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "horeca_modifiers_project_idx" ON "horeca_modifier_groups" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "horeca_order_items_order_idx" ON "horeca_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "horeca_order_items_project_idx" ON "horeca_order_items" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_orders_number_uq" ON "horeca_orders" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "horeca_orders_project_idx" ON "horeca_orders" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "horeca_requests_project_idx" ON "horeca_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "horeca_room_bookings_project_idx" ON "horeca_room_bookings" USING btree ("project_id","check_in");--> statement-breakpoint
CREATE INDEX "horeca_room_types_project_idx" ON "horeca_room_types" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_rooms_number_uq" ON "horeca_rooms" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_tables_token_uq" ON "horeca_tables" USING btree ("token");--> statement-breakpoint
CREATE INDEX "horeca_tables_project_idx" ON "horeca_tables" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_valet_token_uq" ON "horeca_valet" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_valet_ticket_uq" ON "horeca_valet" USING btree ("project_id","ticket");--> statement-breakpoint
CREATE INDEX "horeca_valet_project_idx" ON "horeca_valet" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_venues_token_uq" ON "horeca_venues" USING btree ("token");