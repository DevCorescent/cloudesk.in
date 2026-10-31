ALTER TABLE "finance_books" ADD COLUMN "linked_project_id" uuid;--> statement-breakpoint
ALTER TABLE "store_carts" ADD COLUMN "recovery_token_hash" text;--> statement-breakpoint
ALTER TABLE "store_carts" ADD COLUMN "recovery_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_carts" ADD COLUMN "recovered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "recovery" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_books" ADD CONSTRAINT "finance_books_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;