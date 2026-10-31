CREATE TABLE "platform_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value_enc" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_snapshots" (
	"day" text NOT NULL,
	"key" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "platform_snapshots_day_key_pk" PRIMARY KEY("day","key")
);
--> statement-breakpoint
CREATE UNLOGGED TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_stats" (
	"bucket" timestamp with time zone NOT NULL,
	"node" text NOT NULL,
	"area" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"client_errors" integer DEFAULT 0 NOT NULL,
	"total_ms" bigint DEFAULT 0 NOT NULL,
	"max_ms" integer DEFAULT 0 NOT NULL,
	"hist" integer[] NOT NULL,
	CONSTRAINT "request_stats_bucket_node_area_pk" PRIMARY KEY("bucket","node","area")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reauth_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_config" ADD CONSTRAINT "platform_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limits_reset_idx" ON "rate_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "request_stats_bucket_idx" ON "request_stats" USING btree ("bucket");