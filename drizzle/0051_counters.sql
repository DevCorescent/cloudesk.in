ALTER TABLE "acc_settings" ADD COLUMN "counters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Start each new sequence after the highest number already used under the old shared counters.
UPDATE "acc_settings" s SET "counters" = jsonb_build_object(
  'debit_note', coalesce((SELECT max(nullif(regexp_replace(b.number, '\D', '', 'g'), '')::int) FROM acc_bills b WHERE b.org_id = s.org_id AND b.kind = 'debit_note'), 0) + 1,
  'payment_run', coalesce((SELECT max(nullif(regexp_replace(r.number, '\D', '', 'g'), '')::int) FROM acc_payment_runs r WHERE r.org_id = s.org_id), 0) + 1,
  'receipt', coalesce((SELECT max(nullif(regexp_replace(r.number, '\D', '', 'g'), '')::int) FROM acc_receipts r WHERE r.org_id = s.org_id), 0) + 1
);
