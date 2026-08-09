CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid,
	"parent_run_id" uuid,
	"input_message_id" uuid,
	"external_run_id" text,
	"status" text NOT NULL,
	"model" text,
	"mode" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"exit_code" integer,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cost_amount" numeric(20, 8),
	"cost_currency" text,
	"git_before_sha" text,
	"git_after_sha" text,
	"error_code" text,
	"error_message" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" in ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING', 'CANCELED', 'COMPLETED', 'FAILED', 'DISCONNECTED'))
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid,
	"external_session_id" text,
	"title" text NOT NULL,
	"cwd" text NOT NULL,
	"branch" text,
	"status" text NOT NULL,
	"model" text,
	"mode" text,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "agent_sessions_status_check" CHECK ("agent_sessions"."status" in ('CREATED', 'STARTING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'DISCONNECTED', 'FAILED', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agent_kind" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"executable" text,
	"args_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env_refs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_model" text,
	"default_mode" text,
	"capabilities_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_version" text,
	"status" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_preflight_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_kind_check" CHECK ("agents"."agent_kind" in ('CODEX', 'CLAUDE_CODE', 'OPENCODE', 'HERMES', 'OPENCLAW', 'CUSTOM_ACP')),
	CONSTRAINT "agents_adapter_kind_check" CHECK ("agents"."adapter_kind" in ('ACP_STDIO', 'OPENCLAW_GATEWAY', 'OPENCLAW_EXEC'))
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"options_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_json" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "approval_requests_run_external_unique" UNIQUE("run_id","external_id"),
	CONSTRAINT "approval_requests_status_check" CHECK ("approval_requests"."status" in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"message_id" uuid,
	"type" text NOT NULL,
	"path" text NOT NULL,
	"display_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"sha256" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"hostname" text NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"status" text NOT NULL,
	"container_name" text,
	"expected_container_id" text,
	"start_policy" text,
	"workspace_mappings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connection_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_targets_kind_check" CHECK ("execution_targets"."kind" in ('LOCAL_HOST', 'DOCKER_CONTAINER', 'REMOTE_NODE')),
	CONSTRAINT "execution_targets_start_policy_check" CHECK ("execution_targets"."start_policy" is null or "execution_targets"."start_policy" in ('MANUAL', 'ON_DEMAND')),
	CONSTRAINT "execution_targets_docker_fields_check" CHECK ("execution_targets"."kind" <> 'DOCKER_CONTAINER' or ("execution_targets"."container_name" is not null and "execution_targets"."expected_container_id" is not null and "execution_targets"."start_policy" is not null))
);
--> statement-breakpoint
CREATE TABLE "git_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"snapshot_type" text NOT NULL,
	"head_sha" text,
	"branch" text,
	"status_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diff_stat_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"patch_file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_snapshots_type_check" CHECK ("git_snapshots"."snapshot_type" in ('BEFORE', 'AFTER', 'REVIEW'))
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"success_criteria" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_status_check" CHECK ("goals"."status" in ('DRAFT', 'ACTIVE', 'ACHIEVED', 'CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sequence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_session_sequence_unique" UNIQUE("session_id","sequence"),
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_id" uuid NOT NULL,
	"root_path" text NOT NULL,
	"real_root_path" text NOT NULL,
	"repo_kind" text NOT NULL,
	"default_agent_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "projects_target_real_root_unique" UNIQUE("target_id","real_root_path")
);
--> statement-breakpoint
CREATE TABLE "prompt_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"prompt_id" uuid NOT NULL,
	"selector_type" text NOT NULL,
	"label" text,
	"version_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_bindings_target_check" CHECK ("prompt_bindings"."target_type" in ('PROJECT', 'AGENT', 'TASK')),
	CONSTRAINT "prompt_bindings_slot_check" CHECK ("prompt_bindings"."slot" in ('SYSTEM', 'TASK_PRIMER', 'REVIEW', 'COMMIT', 'RULES')),
	CONSTRAINT "prompt_bindings_selector_check" CHECK ("prompt_bindings"."selector_type" in ('LABEL', 'VERSION')),
	CONSTRAINT "prompt_bindings_selector_value_check" CHECK (("prompt_bindings"."selector_type" = 'LABEL' and "prompt_bindings"."label" is not null and "prompt_bindings"."version_id" is null) or ("prompt_bindings"."selector_type" = 'VERSION' and "prompt_bindings"."version_id" is not null and "prompt_bindings"."label" is null))
);
--> statement-breakpoint
CREATE TABLE "prompt_labels" (
	"prompt_id" uuid NOT NULL,
	"label" text NOT NULL,
	"version_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_labels_prompt_id_label_pk" PRIMARY KEY("prompt_id","label")
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_json" jsonb NOT NULL,
	"variables_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changelog" text,
	"source" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_prompt_version_unique" UNIQUE("prompt_id","version")
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"adapter_event_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_session_seq_unique" UNIQUE("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "skill_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text NOT NULL,
	"root_path" text NOT NULL,
	"manifest_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"goal_id" uuid,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"acceptance_criteria" text,
	"status" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"assigned_agent_id" uuid,
	"session_id" uuid,
	"final_run_id" uuid,
	"branch" text,
	"position" numeric(20, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'BLOCKED', 'CANCELED'))
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_target_id_execution_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."execution_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_snapshots" ADD CONSTRAINT "git_snapshots_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_snapshots" ADD CONSTRAINT "git_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_target_id_execution_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."execution_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_bindings" ADD CONSTRAINT "prompt_bindings_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_bindings" ADD CONSTRAINT "prompt_bindings_version_id_prompt_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_labels" ADD CONSTRAINT "prompt_labels_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_labels" ADD CONSTRAINT "prompt_labels_version_id_prompt_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_bindings" ADD CONSTRAINT "skill_bindings_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_name_unique" ON "api_tokens" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_project_key_unique" ON "prompts" USING btree ("project_id","key") WHERE "prompts"."project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_global_key_unique" ON "prompts" USING btree ("key") WHERE "prompts"."project_id" is null;--> statement-breakpoint
CREATE INDEX "run_events_session_seq_idx" ON "run_events" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "run_events_run_created_idx" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_type_created_idx" ON "run_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "tasks_project_status_position_idx" ON "tasks" USING btree ("project_id","status","position");--> statement-breakpoint
CREATE INDEX "tasks_goal_status_idx" ON "tasks" USING btree ("goal_id","status");--> statement-breakpoint
CREATE INDEX "tasks_agent_status_idx" ON "tasks" USING btree ("assigned_agent_id","status");
--> statement-breakpoint
CREATE FUNCTION prevent_prompt_version_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'prompt_versions are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER prompt_versions_immutable
BEFORE UPDATE ON "prompt_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_prompt_version_update();
