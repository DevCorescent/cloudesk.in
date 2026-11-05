CREATE TABLE "doc_drops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"folder_id" uuid,
	"root" text DEFAULT 'team' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"nonce" text NOT NULL,
	"stay_minutes" integer,
	"uploader_chooses" boolean DEFAULT true NOT NULL,
	"notify_owner" boolean DEFAULT true NOT NULL,
	"uploads" integer DEFAULT 0 NOT NULL,
	"last_upload_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "delete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "drop_id" uuid;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "drop_from" jsonb;--> statement-breakpoint
ALTER TABLE "doc_files" ADD COLUMN "drop_nonce" text;--> statement-breakpoint
ALTER TABLE "doc_drops" ADD CONSTRAINT "doc_drops_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_drops" ADD CONSTRAINT "doc_drops_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_drops" ADD CONSTRAINT "doc_drops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_drops_org_idx" ON "doc_drops" USING btree ("org_id","folder_id");--> statement-breakpoint
CREATE INDEX "doc_files_delete_at_idx" ON "doc_files" USING btree ("delete_at") WHERE delete_at is not null;