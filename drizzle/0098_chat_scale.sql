CREATE INDEX "team_files_message_idx" ON "team_files" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "team_messages_body_trgm_idx" ON "team_messages" USING gin ("body" gin_trgm_ops);