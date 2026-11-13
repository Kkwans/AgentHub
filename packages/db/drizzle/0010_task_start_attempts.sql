CREATE TABLE "task_start_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"expected_old_session_id" uuid,
	"kind" text NOT NULL,
	"phase" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"run_id" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_start_attempts_kind_check" CHECK ("task_start_attempts"."kind" in ('START', 'REWORK')),
	CONSTRAINT "task_start_attempts_phase_check" CHECK ("task_start_attempts"."phase" in ('RESERVED', 'CREATE_ATTEMPTED', 'SESSION_READY', 'RUN_ADMITTED', 'FAILED_KNOWN', 'UNKNOWN'))
);
--> statement-breakpoint
ALTER TABLE "task_start_attempts" ADD CONSTRAINT "task_start_attempts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_start_attempts" ADD CONSTRAINT "task_start_attempts_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_start_attempts" ADD CONSTRAINT "task_start_attempts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_start_attempts" ADD CONSTRAINT "task_start_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_start_attempts_session_unique" ON "task_start_attempts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_start_attempts_active_task_unique" ON "task_start_attempts" USING btree ("task_id") WHERE "task_start_attempts"."phase" in ('RESERVED', 'CREATE_ATTEMPTED', 'SESSION_READY', 'UNKNOWN');