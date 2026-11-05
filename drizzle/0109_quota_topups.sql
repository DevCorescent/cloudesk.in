CREATE TABLE "quota_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"units" double precision NOT NULL,
	"month" text,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quota_topups" ADD CONSTRAINT "quota_topups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_topups" ADD CONSTRAINT "quota_topups_invoice_id_subscription_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."subscription_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quota_topups_org_idx" ON "quota_topups" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_topups_used_uq" ON "quota_topups" USING btree ("org_id","key","month") WHERE kind = 'used';