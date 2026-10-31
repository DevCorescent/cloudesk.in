ALTER TABLE "users" ADD COLUMN "onboarding" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;