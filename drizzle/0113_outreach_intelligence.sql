CREATE TABLE "po_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"mx" boolean NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "po_contacts" ADD COLUMN "verify" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "po_contacts" ADD COLUMN "verify_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "po_contacts" ADD COLUMN "machine_opens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "po_contacts" ADD COLUMN "client" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "po_contacts" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "po_contacts" ADD COLUMN "paid_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "po_contacts" ADD COLUMN "attribution" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "po_enrollments" ADD COLUMN "holdout" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "po_funnels" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "po_funnels" ADD COLUMN "holdout_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "po_sends" ADD COLUMN "machine_opens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "po_sends" ADD COLUMN "machine_clicks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "po_sends" ADD COLUMN "resend" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "po_sends" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "po_sends" ADD COLUMN "revenue" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "po_templates" ADD COLUMN "retired" integer[] DEFAULT '{}'::int[] NOT NULL;