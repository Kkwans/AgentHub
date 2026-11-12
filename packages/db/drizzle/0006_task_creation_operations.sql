CREATE TABLE "task_creation_operations" (
	"owner_scope" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_creation_operations_owner_scope_operation_id_pk" PRIMARY KEY("owner_scope","operation_id")
);
--> statement-breakpoint
ALTER TABLE "task_creation_operations" ADD CONSTRAINT "task_creation_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_creation_operations" ADD CONSTRAINT "task_creation_operations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_creation_operations_project_idx" ON "task_creation_operations" USING btree ("project_id","created_at");