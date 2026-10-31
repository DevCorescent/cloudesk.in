CREATE TABLE "mail_schedule_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"planned_for" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"n" integer,
	"manual" boolean DEFAULT false NOT NULL,
	"message_id" uuid,
	"thread_id" uuid,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_note" text DEFAULT '' NOT NULL,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"separately" boolean DEFAULT false NOT NULL,
	"subject" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"start_date" text NOT NULL,
	"times" jsonb NOT NULL,
	"tz" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"repeat" jsonb NOT NULL,
	"skip_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limit" integer,
	"options" jsonb NOT NULL,
	"meeting" jsonb,
	"event_id" uuid,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"thread_id" uuid,
	"last_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_schedule_files" ADD CONSTRAINT "mail_schedule_files_schedule_id_mail_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mail_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_schedule_runs" ADD CONSTRAINT "mail_schedule_runs_schedule_id_mail_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mail_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_schedule_runs" ADD CONSTRAINT "mail_schedule_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_schedules" ADD CONSTRAINT "mail_schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_schedules" ADD CONSTRAINT "mail_schedules_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_schedules" ADD CONSTRAINT "mail_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_schedules" ADD CONSTRAINT "mail_schedules_event_id_cal_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."cal_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_schedule_files_schedule_idx" ON "mail_schedule_files" USING btree ("schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_schedule_runs_uq" ON "mail_schedule_runs" USING btree ("schedule_id","planned_for");--> statement-breakpoint
CREATE INDEX "mail_schedule_runs_schedule_idx" ON "mail_schedule_runs" USING btree ("schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_schedules_org_idx" ON "mail_schedules" USING btree ("org_id","created_by");--> statement-breakpoint
CREATE INDEX "mail_schedules_due_idx" ON "mail_schedules" USING btree ("next_run_at") WHERE status = 'active';