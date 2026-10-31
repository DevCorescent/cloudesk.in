CREATE TABLE "mail_signature_defaults" (
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"new_id" uuid,
	"reply_id" uuid,
	CONSTRAINT "mail_signature_defaults_user_id_account_id_pk" PRIMARY KEY("user_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "mail_signature_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"design" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_signature_defaults" ADD CONSTRAINT "mail_signature_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_signature_defaults" ADD CONSTRAINT "mail_signature_defaults_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_signature_defaults" ADD CONSTRAINT "mail_signature_defaults_new_id_mail_signatures_id_fk" FOREIGN KEY ("new_id") REFERENCES "public"."mail_signatures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_signature_defaults" ADD CONSTRAINT "mail_signature_defaults_reply_id_mail_signatures_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."mail_signatures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_signature_images" ADD CONSTRAINT "mail_signature_images_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_signature_images" ADD CONSTRAINT "mail_signature_images_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_signatures" ADD CONSTRAINT "mail_signatures_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_signatures" ADD CONSTRAINT "mail_signatures_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_signature_images_owner_idx" ON "mail_signature_images" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "mail_signatures_owner_idx" ON "mail_signatures" USING btree ("org_id","owner_id");