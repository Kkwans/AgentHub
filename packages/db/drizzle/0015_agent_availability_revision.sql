ALTER TABLE "agents" ADD COLUMN "enabled_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_enabled_revision_check" CHECK ("agents"."enabled_revision" >= 0);
