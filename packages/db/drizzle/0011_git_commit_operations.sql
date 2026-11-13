CREATE TABLE "git_commit_operations" (
	"owner_scope" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"protocol_version" integer DEFAULT 1 NOT NULL,
	"request_hash" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"target_id" uuid NOT NULL,
	"execution_device_id" text NOT NULL,
	"repository_key" text NOT NULL,
	"canonical_common_dir" text NOT NULL,
	"worktree_identity" text NOT NULL,
	"expected_head" text,
	"phase" text NOT NULL,
	"dispatch_token" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"before_head" text,
	"observed_after_head" text,
	"command_exit" integer,
	"result_evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "git_commit_operations_owner_scope_operation_id_pk" PRIMARY KEY("owner_scope","operation_id"),
	CONSTRAINT "git_commit_operations_protocol_check" CHECK ("git_commit_operations"."protocol_version" = 1),
	CONSTRAINT "git_commit_operations_phase_check" CHECK ("git_commit_operations"."phase" in ('RECEIVED', 'DISPATCHED', 'COMMAND_SUCCEEDED', 'REJECTED_PREWRITE', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "git_write_claims" (
	"repository_key" text PRIMARY KEY NOT NULL,
	"owner_scope" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"dispatch_token" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"phase" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_write_claims_phase_check" CHECK ("git_write_claims"."phase" in ('RECEIVED', 'DISPATCHED', 'UNKNOWN'))
);
--> statement-breakpoint
ALTER TABLE "git_commit_operations" ADD CONSTRAINT "git_commit_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_commit_operations" ADD CONSTRAINT "git_commit_operations_target_id_execution_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."execution_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_write_claims" ADD CONSTRAINT "git_write_claims_operation_fk" FOREIGN KEY ("owner_scope","operation_id") REFERENCES "public"."git_commit_operations"("owner_scope","operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_commit_operations_project_idx" ON "git_commit_operations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "git_commit_operations_worker_phase_idx" ON "git_commit_operations" USING btree ("worker_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "git_write_claims_operation_unique" ON "git_write_claims" USING btree ("owner_scope","operation_id");