CREATE TABLE "feature_request_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" text DEFAULT 'comment' NOT NULL,
	"from_team" boolean DEFAULT false NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_request_votes" (
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_request_votes_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigserial NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"title" text NOT NULL,
	"problem" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"area" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'important' NOT NULL,
	"scope" text DEFAULT 'everyone' NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"eta" date,
	"public" boolean DEFAULT false NOT NULL,
	"duplicate_of" uuid,
	"flag_key" text,
	"release" jsonb,
	"released_at" timestamp with time zone,
	"votes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_request_notes" ADD CONSTRAINT "feature_request_notes_request_id_feature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_notes" ADD CONSTRAINT "feature_request_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_votes" ADD CONSTRAINT "feature_request_votes_request_id_feature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_votes" ADD CONSTRAINT "feature_request_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_votes" ADD CONSTRAINT "feature_request_votes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_request_notes_req_idx" ON "feature_request_notes" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "feature_requests_org_idx" ON "feature_requests" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "feature_requests_status_idx" ON "feature_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_requests_number_uq" ON "feature_requests" USING btree ("number");