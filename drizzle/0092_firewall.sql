CREATE TABLE "firewall_bans" (
	"ip" text PRIMARY KEY NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"until" timestamp with time zone,
	"created_by" uuid,
	"cloudflare_rule_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firewall_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"country" text,
	"method" text NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"path" text NOT NULL,
	"rule" text NOT NULL,
	"grp" text NOT NULL,
	"action" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"ua" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firewall_bans" ADD CONSTRAINT "firewall_bans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firewall_events_at_idx" ON "firewall_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "firewall_events_ip_idx" ON "firewall_events" USING btree ("ip","at");