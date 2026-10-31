CREATE TABLE "cal_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"uid" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"meeting_url" text DEFAULT '' NOT NULL,
	"meeting_provider" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"tz" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"repeat" jsonb,
	"skip" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organizer" jsonb,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"response" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"mail_account_id" uuid,
	"mail_thread_id" uuid,
	"mail_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence" timestamp with time zone NOT NULL,
	"owner_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"shared_at" timestamp with time zone,
	"shared_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cal_reminders_sent" (
	"event_id" uuid NOT NULL,
	"occurrence" timestamp with time zone NOT NULL,
	"offset" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cal_reminders_sent_event_id_occurrence_offset_pk" PRIMARY KEY("event_id","occurrence","offset")
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "meeting" jsonb;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD COLUMN "meeting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD COLUMN "meeting_event_id" uuid;--> statement-breakpoint
ALTER TABLE "cal_calendars" ADD CONSTRAINT "cal_calendars_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_calendars" ADD CONSTRAINT "cal_calendars_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_events" ADD CONSTRAINT "cal_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_events" ADD CONSTRAINT "cal_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_events" ADD CONSTRAINT "cal_events_calendar_id_cal_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."cal_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_events" ADD CONSTRAINT "cal_events_mail_account_id_mail_accounts_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_events" ADD CONSTRAINT "cal_events_mail_thread_id_mail_threads_id_fk" FOREIGN KEY ("mail_thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_events" ADD CONSTRAINT "cal_events_mail_message_id_mail_messages_id_fk" FOREIGN KEY ("mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_notes" ADD CONSTRAINT "cal_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_notes" ADD CONSTRAINT "cal_notes_event_id_cal_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."cal_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_notes" ADD CONSTRAINT "cal_notes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_reminders_sent" ADD CONSTRAINT "cal_reminders_sent_event_id_cal_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."cal_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cal_calendars_owner_idx" ON "cal_calendars" USING btree ("org_id","owner_id");--> statement-breakpoint
CREATE INDEX "cal_events_owner_time_idx" ON "cal_events" USING btree ("org_id","owner_id","starts_at");--> statement-breakpoint
CREATE INDEX "cal_events_uid_idx" ON "cal_events" USING btree ("owner_id","uid");--> statement-breakpoint
CREATE UNIQUE INDEX "cal_notes_occurrence_uq" ON "cal_notes" USING btree ("event_id","occurrence");