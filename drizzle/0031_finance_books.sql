CREATE TABLE "finance_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_owners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"book_id" uuid
);
--> statement-breakpoint
ALTER TABLE "invoice_clients" DROP CONSTRAINT "invoice_clients_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_documents" DROP CONSTRAINT "invoice_documents_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_items" DROP CONSTRAINT "invoice_items_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_payments" DROP CONSTRAINT "invoice_payments_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_settings" DROP CONSTRAINT "invoice_settings_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_templates" DROP CONSTRAINT "invoice_templates_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "finance_books" ADD CONSTRAINT "finance_books_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_books" ADD CONSTRAINT "finance_books_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_files" ADD CONSTRAINT "finance_files_book_id_finance_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."finance_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_files" ADD CONSTRAINT "finance_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_owners" ADD CONSTRAINT "invoice_owners_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_owners" ADD CONSTRAINT "invoice_owners_book_id_finance_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."finance_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing invoicing data belongs to projects: give each project an owner row with the same id.
INSERT INTO "invoice_owners" ("id", "project_id")
SELECT DISTINCT o.pid, o.pid FROM (
  SELECT "project_id" AS pid FROM "invoice_settings" UNION SELECT "project_id" FROM "invoice_templates" UNION SELECT "project_id" FROM "invoice_clients"
  UNION SELECT "project_id" FROM "invoice_items" UNION SELECT "project_id" FROM "invoice_documents" UNION SELECT "project_id" FROM "invoice_payments"
) o JOIN "projects" p ON p."id" = o.pid
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "invoice_owners" ADD CONSTRAINT "invoice_owners_one_kind" CHECK (("project_id" IS NULL) <> ("book_id" IS NULL));--> statement-breakpoint
CREATE INDEX "finance_books_org_idx" ON "finance_books" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "invoice_clients" ADD CONSTRAINT "invoice_clients_project_id_invoice_owners_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."invoice_owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_project_id_invoice_owners_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."invoice_owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_project_id_invoice_owners_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."invoice_owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_project_id_invoice_owners_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."invoice_owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_project_id_invoice_owners_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."invoice_owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_project_id_invoice_owners_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."invoice_owners"("id") ON DELETE cascade ON UPDATE no action;