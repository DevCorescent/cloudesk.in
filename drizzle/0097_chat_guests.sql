CREATE TABLE "team_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"invite_id" uuid,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"since_seq" bigint DEFAULT 0 NOT NULL,
	"history" boolean DEFAULT false NOT NULL,
	"files" boolean DEFAULT true NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"ip" text,
	"user_agent" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"approval" boolean DEFAULT true NOT NULL,
	"history" boolean DEFAULT false NOT NULL,
	"files" boolean DEFAULT true NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_guests" ADD CONSTRAINT "team_guests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_guests" ADD CONSTRAINT "team_guests_channel_id_team_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."team_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_guests" ADD CONSTRAINT "team_guests_invite_id_team_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."team_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_guests" ADD CONSTRAINT "team_guests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_guests" ADD CONSTRAINT "team_guests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_channel_id_team_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."team_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_guests_token_uq" ON "team_guests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "team_guests_channel_idx" ON "team_guests" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX "team_guests_user_idx" ON "team_guests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_code_uq" ON "team_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "team_invites_channel_idx" ON "team_invites" USING btree ("channel_id");