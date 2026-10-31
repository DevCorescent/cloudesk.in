CREATE TABLE "hd_canned" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hd_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"from_name" text DEFAULT '' NOT NULL,
	"from_email" text DEFAULT '' NOT NULL,
	"email_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hd_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inbound_token" text NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hd_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"channel" text DEFAULT 'manual' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"contact_id" uuid,
	"assignee_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_response_due" timestamp with time zone,
	"resolve_due" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"remaining_mins" integer,
	"first_breached" boolean DEFAULT false NOT NULL,
	"resolve_breached" boolean DEFAULT false NOT NULL,
	"csat" integer,
	"csat_comment" text DEFAULT '' NOT NULL,
	"last_customer_at" timestamp with time zone,
	"last_agent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hd_canned" ADD CONSTRAINT "hd_canned_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_canned" ADD CONSTRAINT "hd_canned_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_messages" ADD CONSTRAINT "hd_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_messages" ADD CONSTRAINT "hd_messages_ticket_id_hd_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."hd_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_messages" ADD CONSTRAINT "hd_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_settings" ADD CONSTRAINT "hd_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_tickets" ADD CONSTRAINT "hd_tickets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_tickets" ADD CONSTRAINT "hd_tickets_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_tickets" ADD CONSTRAINT "hd_tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hd_tickets" ADD CONSTRAINT "hd_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hd_messages_ticket_idx" ON "hd_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hd_messages_email_uq" ON "hd_messages" USING btree ("org_id","email_id") WHERE "hd_messages"."email_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "hd_tickets_number_uq" ON "hd_tickets" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "hd_tickets_status_idx" ON "hd_tickets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "hd_tickets_email_idx" ON "hd_tickets" USING btree ("org_id",lower("customer_email"));