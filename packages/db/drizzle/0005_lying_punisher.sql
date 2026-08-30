CREATE TABLE "session_continuations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_session_id" uuid NOT NULL,
	"target_session_id" uuid NOT NULL,
	"strategy" text NOT NULL,
	"input_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary_text" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "session_continuations_target_unique" UNIQUE("target_session_id"),
	CONSTRAINT "session_continuations_strategy_check" CHECK ("session_continuations"."strategy" in ('MODEL', 'DETERMINISTIC'))
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "reasoning_effort" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_continuations" ADD CONSTRAINT "session_continuations_source_session_id_agent_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_continuations" ADD CONSTRAINT "session_continuations_target_session_id_agent_sessions_id_fk" FOREIGN KEY ("target_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_continuations_source_idx" ON "session_continuations" USING btree ("source_session_id","generated_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_kind_check" CHECK ("projects"."kind" in ('STANDARD', 'TEST'));