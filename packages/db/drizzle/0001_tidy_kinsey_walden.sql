CREATE TABLE "worktree_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text NOT NULL,
	"base_branch" text NOT NULL,
	"base_sha" text NOT NULL,
	"task_branch" text NOT NULL,
	"worktree_path" text,
	"session_id" uuid,
	"run_id" uuid,
	"merge_commit_sha" text,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"review_ready_at" timestamp with time zone,
	"merge_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worktree_executions_project_branch_unique" UNIQUE("project_id","task_branch"),
	CONSTRAINT "worktree_executions_status_check" CHECK ("worktree_executions"."status" in ('QUEUED', 'SETTING_UP', 'RUNNING', 'AWAITING_INPUT', 'REVIEW', 'MERGING', 'DONE', 'BLOCKED', 'CANCELED'))
);
--> statement-breakpoint
ALTER TABLE "worktree_executions" ADD CONSTRAINT "worktree_executions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_executions" ADD CONSTRAINT "worktree_executions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_executions" ADD CONSTRAINT "worktree_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_executions" ADD CONSTRAINT "worktree_executions_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_executions" ADD CONSTRAINT "worktree_executions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worktree_executions_project_queue_idx" ON "worktree_executions" USING btree ("project_id","status","queued_at");--> statement-breakpoint
CREATE INDEX "worktree_executions_task_created_idx" ON "worktree_executions" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worktree_executions_path_unique" ON "worktree_executions" USING btree ("worktree_path") WHERE "worktree_executions"."worktree_path" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "worktree_executions_task_active_unique" ON "worktree_executions" USING btree ("task_id") WHERE "worktree_executions"."status" in ('QUEUED', 'SETTING_UP', 'RUNNING', 'AWAITING_INPUT', 'REVIEW', 'MERGING');--> statement-breakpoint
CREATE UNIQUE INDEX "worktree_executions_project_active_unique" ON "worktree_executions" USING btree ("project_id") WHERE "worktree_executions"."status" in ('SETTING_UP', 'RUNNING', 'AWAITING_INPUT', 'REVIEW', 'MERGING');