ALTER TABLE "agent_sessions" ADD COLUMN "archive_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_archive_revision_check" CHECK ("agent_sessions"."archive_revision" >= 0);
