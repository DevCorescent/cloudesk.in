CREATE TABLE "store_catalogue_stats" (
	"catalogue_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "store_catalogue_stats_catalogue_id_day_source_pk" PRIMARY KEY("catalogue_id","day","source")
);
--> statement-breakpoint
ALTER TABLE "store_catalogues" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_catalogues" ADD COLUMN "access_code_hash" text;--> statement-breakpoint
ALTER TABLE "store_catalogues" ADD COLUMN "allow_embed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_catalogues" ADD COLUMN "product_orders" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "store_catalogue_stats" ADD CONSTRAINT "store_catalogue_stats_catalogue_id_store_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."store_catalogues"("id") ON DELETE cascade ON UPDATE no action;