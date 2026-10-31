CREATE TABLE "brand_guardrails" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"lock_palette" boolean DEFAULT false NOT NULL,
	"palette" jsonb,
	"lock_fonts" boolean DEFAULT false NOT NULL,
	"font" text,
	"heading_font" text,
	"lock_logo" boolean DEFAULT false NOT NULL,
	"logo" text,
	"voice" text DEFAULT '' NOT NULL,
	"banned_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferred_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_guardrails" ADD CONSTRAINT "brand_guardrails_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_guardrails" ADD CONSTRAINT "brand_guardrails_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;