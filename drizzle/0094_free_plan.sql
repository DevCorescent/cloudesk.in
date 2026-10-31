ALTER TABLE "org_subscriptions" ADD COLUMN "quotas" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_catalog" ADD COLUMN "quotas" jsonb DEFAULT '{}'::jsonb NOT NULL;