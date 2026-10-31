CREATE TABLE "horeca_cash_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"staff_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"staff_name" text DEFAULT '' NOT NULL,
	"approved_by" text DEFAULT '' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"birthday" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"spend" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"last_visit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid,
	"invoice_no" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text DEFAULT 'reservation' NOT NULL,
	"guest_name" text NOT NULL,
	"guest_phone" text DEFAULT '' NOT NULL,
	"party_size" integer DEFAULT 2 NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 90 NOT NULL,
	"table_id" uuid,
	"status" text DEFAULT 'booked' NOT NULL,
	"source" text DEFAULT 'staff' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" text DEFAULT '' NOT NULL,
	"opening_float" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" text DEFAULT '' NOT NULL,
	"closed_at" timestamp with time zone,
	"expected_cash" integer,
	"counted_cash" integer,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'waiter' NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"unit" text DEFAULT 'g' NOT NULL,
	"pack_size" integer DEFAULT 1000 NOT NULL,
	"cost_per_pack" integer DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"reorder_at" integer DEFAULT 0 NOT NULL,
	"supplier_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"order_item_id" uuid,
	"purchase_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horeca_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "horeca_items" ADD COLUMN "recipe" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_items" ADD COLUMN "code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_order_items" ADD COLUMN "comp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_order_items" ADD COLUMN "void_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_order_items" ADD COLUMN "staff_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_order_items" ADD COLUMN "recipe" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD COLUMN "covers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD COLUMN "guest_id" uuid;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD COLUMN "staff_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD COLUMN "delivery_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD COLUMN "delivery_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD COLUMN "points_earned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_orders" ADD COLUMN "cancel_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "horeca_cash_moves" ADD CONSTRAINT "horeca_cash_moves_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_cash_moves" ADD CONSTRAINT "horeca_cash_moves_shift_id_horeca_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."horeca_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_events" ADD CONSTRAINT "horeca_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_feedback" ADD CONSTRAINT "horeca_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_guests" ADD CONSTRAINT "horeca_guests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_purchases" ADD CONSTRAINT "horeca_purchases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_purchases" ADD CONSTRAINT "horeca_purchases_supplier_id_horeca_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."horeca_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_reservations" ADD CONSTRAINT "horeca_reservations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_reservations" ADD CONSTRAINT "horeca_reservations_table_id_horeca_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."horeca_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_shifts" ADD CONSTRAINT "horeca_shifts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_staff" ADD CONSTRAINT "horeca_staff_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_stock_counts" ADD CONSTRAINT "horeca_stock_counts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_stock_items" ADD CONSTRAINT "horeca_stock_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_stock_items" ADD CONSTRAINT "horeca_stock_items_supplier_id_horeca_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."horeca_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_stock_moves" ADD CONSTRAINT "horeca_stock_moves_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_stock_moves" ADD CONSTRAINT "horeca_stock_moves_stock_item_id_horeca_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."horeca_stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horeca_suppliers" ADD CONSTRAINT "horeca_suppliers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "horeca_cash_moves_shift_idx" ON "horeca_cash_moves" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "horeca_events_project_idx" ON "horeca_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_feedback_order_uq" ON "horeca_feedback" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "horeca_feedback_project_idx" ON "horeca_feedback" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "horeca_guests_phone_uq" ON "horeca_guests" USING btree ("project_id","phone");--> statement-breakpoint
CREATE INDEX "horeca_purchases_project_idx" ON "horeca_purchases" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "horeca_reservations_project_idx" ON "horeca_reservations" USING btree ("project_id","at");--> statement-breakpoint
CREATE INDEX "horeca_shifts_project_idx" ON "horeca_shifts" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "horeca_staff_project_idx" ON "horeca_staff" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "horeca_stock_counts_project_idx" ON "horeca_stock_counts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "horeca_stock_items_project_idx" ON "horeca_stock_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "horeca_stock_moves_item_idx" ON "horeca_stock_moves" USING btree ("stock_item_id","created_at");--> statement-breakpoint
CREATE INDEX "horeca_suppliers_project_idx" ON "horeca_suppliers" USING btree ("project_id");