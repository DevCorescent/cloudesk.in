CREATE TABLE "mail_auto_replies" (
	"account_id" uuid NOT NULL,
	"address" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_auto_replies_account_id_address_pk" PRIMARY KEY("account_id","address")
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD COLUMN "muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD COLUMN "awaiting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_auto_replies" ADD CONSTRAINT "mail_auto_replies_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_account_date_idx" ON "mail_messages" USING btree ("account_id","date");--> statement-breakpoint
UPDATE "mail_threads" t SET "awaiting_since" = x.since FROM (
  SELECT m."thread_id", min(m."date") AS since FROM "mail_messages" m
  WHERE m."direction" = 'in' AND m."date" > coalesce((SELECT max(o."date") FROM "mail_messages" o WHERE o."thread_id" = m."thread_id" AND o."direction" = 'out' AND o."send_status" = 'sent' AND NOT o."auto"), '-infinity'::timestamptz)
  GROUP BY m."thread_id"
) x WHERE x."thread_id" = t."id";
