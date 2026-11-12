CREATE TABLE "po_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"industry" text DEFAULT 'other' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"consent" text DEFAULT 'legitimate_interest' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"sends" integer DEFAULT 0 NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"unopened_run" integer DEFAULT 0 NOT NULL,
	"best_hour" integer,
	"last_email_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"signed_up_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"user_id" uuid,
	"converted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"step_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"next_at" timestamp with time zone,
	"last_send_id" uuid,
	"exit_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"send_id" uuid,
	"funnel_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"kind" text DEFAULT 'funnel' NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goal" text DEFAULT 'signed_up' NOT NULL,
	"auto_enroll" boolean DEFAULT true NOT NULL,
	"auto_optimize" boolean DEFAULT true NOT NULL,
	"start_at" timestamp with time zone,
	"paused_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"funnel_id" uuid,
	"template_id" uuid,
	"step_id" text,
	"variant" integer DEFAULT 0 NOT NULL,
	"subject" text NOT NULL,
	"industry" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"subjects" text[] NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"cta_label" text DEFAULT '' NOT NULL,
	"cta_url" text DEFAULT '' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "po_contacts" ADD CONSTRAINT "po_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_enrollments" ADD CONSTRAINT "po_enrollments_funnel_id_po_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."po_funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_enrollments" ADD CONSTRAINT "po_enrollments_contact_id_po_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."po_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_events" ADD CONSTRAINT "po_events_contact_id_po_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."po_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_sends" ADD CONSTRAINT "po_sends_contact_id_po_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."po_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_sends" ADD CONSTRAINT "po_sends_funnel_id_po_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."po_funnels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_sends" ADD CONSTRAINT "po_sends_template_id_po_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."po_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "po_contacts_email_uq" ON "po_contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "po_contacts_stage_idx" ON "po_contacts" USING btree ("status","stage");--> statement-breakpoint
CREATE INDEX "po_contacts_score_idx" ON "po_contacts" USING btree ("score");--> statement-breakpoint
CREATE UNIQUE INDEX "po_enrollments_uq" ON "po_enrollments" USING btree ("funnel_id","contact_id");--> statement-breakpoint
CREATE INDEX "po_enrollments_due_idx" ON "po_enrollments" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "po_events_contact_idx" ON "po_events" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "po_events_kind_idx" ON "po_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "po_sends_token_uq" ON "po_sends" USING btree ("token");--> statement-breakpoint
CREATE INDEX "po_sends_contact_idx" ON "po_sends" USING btree ("contact_id","sent_at");--> statement-breakpoint
CREATE INDEX "po_sends_funnel_idx" ON "po_sends" USING btree ("funnel_id","sent_at");--> statement-breakpoint
CREATE INDEX "po_sends_template_idx" ON "po_sends" USING btree ("template_id","variant");--> statement-breakpoint
CREATE INDEX "po_sends_sent_idx" ON "po_sends" USING btree ("sent_at");