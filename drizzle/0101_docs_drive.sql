CREATE TABLE "doc_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid,
	"folder_id" uuid,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"parent_id" uuid,
	"quote" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "doc_live_updates" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_recents" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_recents_user_id_file_id_pk" PRIMARY KEY("user_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "doc_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid,
	"folder_id" uuid,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'view' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_stars" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_stars_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "kind" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "body_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "words" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "page" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "icon" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "access" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "share_token_hash" text;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "share_role" text;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "share_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "last_edited_by" uuid;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD COLUMN "color" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "doc_activity" ADD CONSTRAINT "doc_activity_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_activity" ADD CONSTRAINT "doc_activity_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_live_updates" ADD CONSTRAINT "doc_live_updates_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_recents" ADD CONSTRAINT "doc_recents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_recents" ADD CONSTRAINT "doc_recents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_recents" ADD CONSTRAINT "doc_recents_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_stars" ADD CONSTRAINT "doc_stars_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_stars" ADD CONSTRAINT "doc_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_activity_file_idx" ON "doc_activity" USING btree ("file_id","at");--> statement-breakpoint
CREATE INDEX "doc_activity_org_idx" ON "doc_activity" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "doc_comments_file_idx" ON "doc_comments" USING btree ("file_id","created_at");--> statement-breakpoint
CREATE INDEX "doc_live_updates_file_idx" ON "doc_live_updates" USING btree ("file_id","seq");--> statement-breakpoint
CREATE INDEX "doc_recents_user_idx" ON "doc_recents" USING btree ("org_id","user_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_shares_file_uq" ON "doc_shares" USING btree ("file_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_shares_folder_uq" ON "doc_shares" USING btree ("folder_id","user_id");--> statement-breakpoint
CREATE INDEX "doc_shares_user_idx" ON "doc_shares" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "doc_stars_org_idx" ON "doc_stars" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_files_share_uq" ON "doc_files" USING btree ("share_token_hash");--> statement-breakpoint
CREATE INDEX "doc_files_owner_idx" ON "doc_files" USING btree ("org_id","created_by");