ALTER TABLE "worktree_executions" ADD COLUMN "git_merge_generation" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "worktree_executions" ADD CONSTRAINT "worktree_executions_git_merge_generation_check" CHECK ("worktree_executions"."git_merge_generation" >= 0);
