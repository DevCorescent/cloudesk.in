CREATE TABLE "business_card_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_card_templates" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lock_style" boolean DEFAULT false NOT NULL,
	"lock_company" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hidden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"exchange" boolean DEFAULT true NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discoverable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business_card_exchanges" ADD CONSTRAINT "business_card_exchanges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_card_exchanges" ADD CONSTRAINT "business_card_exchanges_card_id_business_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."business_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_card_templates" ADD CONSTRAINT "business_card_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_card_templates" ADD CONSTRAINT "business_card_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_cards" ADD CONSTRAINT "business_cards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_cards" ADD CONSTRAINT "business_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_card_exchanges_card_idx" ON "business_card_exchanges" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_cards_member_uq" ON "business_cards" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_cards_slug_uq" ON "business_cards" USING btree (lower("slug"));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
-- Every real account gets a username from its email (chat guests' hidden identities don't).
UPDATE "users" u SET "username" = s.handle FROM (
  SELECT id, CASE WHEN row_number() OVER (PARTITION BY base ORDER BY created_at) = 1 THEN base ELSE left(base, 20) || '.' || substr(replace(id::text, '-', ''), 1, 4) END AS handle
  FROM (
    SELECT id, created_at, CASE WHEN length(b) < 3 THEN b || 'user' ELSE b END AS base
    FROM (SELECT id, created_at, left(trim(both '._' from regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._]', '', 'g')), 24) AS b FROM "users" WHERE email NOT LIKE '%@guest.cloudesk.invalid' AND username IS NULL) raw
  ) based
) s WHERE u.id = s.id;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree (lower("username")) WHERE username is not null;