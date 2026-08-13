CREATE TABLE "approval_delivery_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"approval_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"external_approval_id" text NOT NULL,
	"decision_status" text NOT NULL,
	"option_id" text NOT NULL,
	"idempotency_scope" text DEFAULT 'NONE' NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"receipt_id" text,
	"last_error_code" text,
	"last_error_message" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delivery_outbox_decision_check" CHECK ("approval_delivery_outbox"."decision_status" in ('APPROVED', 'REJECTED', 'CANCELED')),
	CONSTRAINT "approval_delivery_outbox_scope_check" CHECK ("approval_delivery_outbox"."idempotency_scope" in ('NONE', 'RUNTIME', 'DURABLE')),
	CONSTRAINT "approval_delivery_outbox_state_check" CHECK ("approval_delivery_outbox"."state" in ('QUEUED', 'CLAIMED', 'DISPATCHING', 'RETRY_WAIT', 'DELIVERED', 'UNKNOWN', 'DEAD'))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "selected_option_id" text;--> statement-breakpoint
UPDATE "approval_requests"
SET "selected_option_id" = "response_json"->>'optionId'
WHERE "selected_option_id" IS NULL
	AND "status" <> 'PENDING'
	AND "response_json" ? 'optionId';--> statement-breakpoint
ALTER TABLE "approval_delivery_outbox" ADD CONSTRAINT "approval_delivery_outbox_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delivery_outbox" ADD CONSTRAINT "approval_delivery_outbox_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delivery_outbox" ADD CONSTRAINT "approval_delivery_outbox_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_delivery_outbox_approval_unique" ON "approval_delivery_outbox" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "approval_delivery_outbox_session_created_idx" ON "approval_delivery_outbox" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_delivery_outbox_due_idx" ON "approval_delivery_outbox" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "approval_delivery_outbox_lease_idx" ON "approval_delivery_outbox" USING btree ("state","lease_until");
