CREATE TABLE "mkt_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"segment_id" uuid,
	"subject" text DEFAULT '' NOT NULL,
	"subject_b" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"budget" bigint DEFAULT 0 NOT NULL,
	"spend" bigint DEFAULT 0 NOT NULL,
	"slug" text NOT NULL,
	"start_on" date,
	"end_on" date,
	"event_at" timestamp with time zone,
	"venue" text DEFAULT '' NOT NULL,
	"online_url" text DEFAULT '' NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"reg_token" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mkt_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"url" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mkt_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"attended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mkt_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mkt_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"variant" text DEFAULT 'A' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"clicks" integer DEFAULT 0 NOT NULL,
	"first_click_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mkt_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mkt_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_segment_id_mkt_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."mkt_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_clicks" ADD CONSTRAINT "mkt_clicks_send_id_mkt_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."mkt_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_clicks" ADD CONSTRAINT "mkt_clicks_campaign_id_mkt_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mkt_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_registrations" ADD CONSTRAINT "mkt_registrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_registrations" ADD CONSTRAINT "mkt_registrations_campaign_id_mkt_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mkt_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_registrations" ADD CONSTRAINT "mkt_registrations_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_segments" ADD CONSTRAINT "mkt_segments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_segments" ADD CONSTRAINT "mkt_segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_sends" ADD CONSTRAINT "mkt_sends_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_sends" ADD CONSTRAINT "mkt_sends_campaign_id_mkt_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mkt_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_sends" ADD CONSTRAINT "mkt_sends_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_settings" ADD CONSTRAINT "mkt_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_touches" ADD CONSTRAINT "mkt_touches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_touches" ADD CONSTRAINT "mkt_touches_campaign_id_mkt_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mkt_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_touches" ADD CONSTRAINT "mkt_touches_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_campaigns_slug_uq" ON "mkt_campaigns" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_campaigns_reg_uq" ON "mkt_campaigns" USING btree ("reg_token");--> statement-breakpoint
CREATE INDEX "mkt_campaigns_org_idx" ON "mkt_campaigns" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "mkt_clicks_campaign_idx" ON "mkt_clicks" USING btree ("campaign_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_registrations_uq" ON "mkt_registrations" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "mkt_segments_org_idx" ON "mkt_segments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_sends_uq" ON "mkt_sends" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "mkt_sends_queue_idx" ON "mkt_sends" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "mkt_touches_contact_idx" ON "mkt_touches" USING btree ("org_id","contact_id","at");--> statement-breakpoint
CREATE INDEX "mkt_touches_campaign_idx" ON "mkt_touches" USING btree ("campaign_id");