ALTER TABLE "tasks" ADD COLUMN "prompt_variables_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
