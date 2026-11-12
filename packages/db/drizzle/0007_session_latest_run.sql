-- Historical latest admission is unknown. Leave NULL rather than guessing from timestamps.
ALTER TABLE "agent_sessions" ADD COLUMN "latest_run_id" uuid;
