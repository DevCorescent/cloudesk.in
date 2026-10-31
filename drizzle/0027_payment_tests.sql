CREATE TABLE "payment_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"ref" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_event_id" text,
	"capture_ref" text,
	"provider_says_paid" boolean,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"webhook_at" timestamp with time zone,
	"refunded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_tests" ADD CONSTRAINT "payment_tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_tests" ADD CONSTRAINT "payment_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_tests_project_idx" ON "payment_tests" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_tests_ref_idx" ON "payment_tests" USING btree ("ref");