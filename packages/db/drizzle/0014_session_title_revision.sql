ALTER TABLE "agent_sessions" ADD COLUMN "title_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_title_revision_check" CHECK ("agent_sessions"."title_revision" >= 0);
