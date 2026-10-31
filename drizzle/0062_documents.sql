CREATE TABLE "doc_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'customer' NOT NULL,
	"counterparty" text NOT NULL,
	"counterparty_email" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"value" bigint DEFAULT 0 NOT NULL,
	"start_on" date,
	"end_on" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"renewal_months" integer DEFAULT 12 NOT NULL,
	"notice_days" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"file_id" uuid,
	"link_type" text,
	"link_id" uuid,
	"obligations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"terminated_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'final' NOT NULL,
	"expires_on" date,
	"link_type" text,
	"link_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"access" text DEFAULT 'team' NOT NULL,
	"member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_sign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"signer_id" uuid,
	"kind" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_sign_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"contract_id" uuid,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"sequential" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"certificate" "bytea",
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"order" integer NOT NULL,
	"token_hash" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_name" text,
	"ip" text,
	"user_agent" text,
	"decline_reason" text
);
--> statement-breakpoint
CREATE TABLE "doc_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_contracts" ADD CONSTRAINT "doc_contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_contracts" ADD CONSTRAINT "doc_contracts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_contracts" ADD CONSTRAINT "doc_contracts_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_contracts" ADD CONSTRAINT "doc_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_files" ADD CONSTRAINT "doc_files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_files" ADD CONSTRAINT "doc_files_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_files" ADD CONSTRAINT "doc_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_settings" ADD CONSTRAINT "doc_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sign_events" ADD CONSTRAINT "doc_sign_events_request_id_doc_sign_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."doc_sign_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sign_requests" ADD CONSTRAINT "doc_sign_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sign_requests" ADD CONSTRAINT "doc_sign_requests_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sign_requests" ADD CONSTRAINT "doc_sign_requests_version_id_doc_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."doc_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sign_requests" ADD CONSTRAINT "doc_sign_requests_contract_id_doc_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."doc_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sign_requests" ADD CONSTRAINT "doc_sign_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_signers" ADD CONSTRAINT "doc_signers_request_id_doc_sign_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."doc_sign_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_contracts_number_uq" ON "doc_contracts" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "doc_contracts_org_idx" ON "doc_contracts" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "doc_files_org_idx" ON "doc_files" USING btree ("org_id","folder_id");--> statement-breakpoint
CREATE INDEX "doc_files_link_idx" ON "doc_files" USING btree ("org_id","link_type","link_id");--> statement-breakpoint
CREATE INDEX "doc_folders_org_idx" ON "doc_folders" USING btree ("org_id","parent_id");--> statement-breakpoint
CREATE INDEX "doc_sign_events_request_idx" ON "doc_sign_events" USING btree ("request_id","at");--> statement-breakpoint
CREATE INDEX "doc_sign_requests_org_idx" ON "doc_sign_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "doc_signers_request_idx" ON "doc_signers" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_signers_token_uq" ON "doc_signers" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_versions_uq" ON "doc_versions" USING btree ("file_id","version");