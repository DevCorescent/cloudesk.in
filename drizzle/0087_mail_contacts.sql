CREATE TABLE "mail_contact_group_members" (
	"group_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	CONSTRAINT "mail_contact_group_members_group_id_contact_id_pk" PRIMARY KEY("group_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "mail_contact_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid,
	"name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"last_emailed_at" timestamp with time zone,
	"email_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_contact_group_members" ADD CONSTRAINT "mail_contact_group_members_group_id_mail_contact_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."mail_contact_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_contact_group_members" ADD CONSTRAINT "mail_contact_group_members_contact_id_mail_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."mail_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_contact_groups" ADD CONSTRAINT "mail_contact_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_contact_groups" ADD CONSTRAINT "mail_contact_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_contacts" ADD CONSTRAINT "mail_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_contacts" ADD CONSTRAINT "mail_contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_contact_group_members_contact_idx" ON "mail_contact_group_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_contact_groups_org_name_uq" ON "mail_contact_groups" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "mail_contacts_org_email_uq" ON "mail_contacts" USING btree ("org_id",lower("email"));--> statement-breakpoint
CREATE INDEX "mail_contacts_org_name_idx" ON "mail_contacts" USING btree ("org_id","name");