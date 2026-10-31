CREATE TABLE "codoc_updates" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"doc_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codocs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"base_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codoc_updates" ADD CONSTRAINT "codoc_updates_doc_id_codocs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."codocs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codocs" ADD CONSTRAINT "codocs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codoc_updates_doc_idx" ON "codoc_updates" USING btree ("doc_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "codocs_path_uq" ON "codocs" USING btree ("project_id","path");