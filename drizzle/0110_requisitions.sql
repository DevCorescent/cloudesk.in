CREATE TABLE "rq_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rq_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"item_id" uuid,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text DEFAULT '' NOT NULL,
	"data" "bytea" NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"received_via" text,
	"received_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"confidence" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rq_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"client_name" text DEFAULT '' NOT NULL,
	"client_email" text NOT NULL,
	"cc" text[] DEFAULT '{}' NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"due_date" date,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mail_account_id" uuid,
	"thread_id" uuid,
	"last_mail_id" uuid,
	"next_reminder_at" timestamp with time zone,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_reply_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"nonce" text NOT NULL,
	"owner_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rq_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"mail_message_id" uuid,
	"header_id" text,
	"from_email" text DEFAULT '' NOT NULL,
	"to" text[] DEFAULT '{}' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"analysis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rq_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rq_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rq_events" ADD CONSTRAINT "rq_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_events" ADD CONSTRAINT "rq_events_list_id_rq_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."rq_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_events" ADD CONSTRAINT "rq_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_files" ADD CONSTRAINT "rq_files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_files" ADD CONSTRAINT "rq_files_list_id_rq_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."rq_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_files" ADD CONSTRAINT "rq_files_item_id_rq_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."rq_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_items" ADD CONSTRAINT "rq_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_items" ADD CONSTRAINT "rq_items_list_id_rq_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."rq_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_lists" ADD CONSTRAINT "rq_lists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_lists" ADD CONSTRAINT "rq_lists_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_lists" ADD CONSTRAINT "rq_lists_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_lists" ADD CONSTRAINT "rq_lists_mail_account_id_mail_accounts_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_lists" ADD CONSTRAINT "rq_lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_lists" ADD CONSTRAINT "rq_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_messages" ADD CONSTRAINT "rq_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_messages" ADD CONSTRAINT "rq_messages_list_id_rq_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."rq_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_settings" ADD CONSTRAINT "rq_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_templates" ADD CONSTRAINT "rq_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rq_templates" ADD CONSTRAINT "rq_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rq_events_list_idx" ON "rq_events" USING btree ("list_id","created_at");--> statement-breakpoint
CREATE INDEX "rq_files_list_idx" ON "rq_files" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "rq_items_list_idx" ON "rq_items" USING btree ("list_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "rq_lists_number_uq" ON "rq_lists" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "rq_lists_org_status_idx" ON "rq_lists" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "rq_lists_due_idx" ON "rq_lists" USING btree ("next_reminder_at") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "rq_lists_email_idx" ON "rq_lists" USING btree ("org_id",lower(client_email));--> statement-breakpoint
CREATE INDEX "rq_lists_thread_idx" ON "rq_lists" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "rq_messages_list_idx" ON "rq_messages" USING btree ("list_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rq_messages_header_uq" ON "rq_messages" USING btree ("org_id","header_id") WHERE header_id is not null and header_id <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "rq_messages_mail_uq" ON "rq_messages" USING btree ("mail_message_id") WHERE mail_message_id is not null;