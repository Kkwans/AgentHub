CREATE TABLE "remote_node_registration_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"allowed_roots_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_node_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remote_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"protocol_version" text NOT NULL,
	"daemon_version" text NOT NULL,
	"allowed_roots_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inventory_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remote_nodes_status_check" CHECK ("remote_nodes"."status" in ('ONLINE', 'OFFLINE', 'REVOKED'))
);
--> statement-breakpoint
ALTER TABLE "remote_node_registration_tokens" ADD CONSTRAINT "remote_node_registration_tokens_used_by_node_id_remote_nodes_id_fk" FOREIGN KEY ("used_by_node_id") REFERENCES "public"."remote_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_nodes" ADD CONSTRAINT "remote_nodes_target_id_execution_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."execution_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "remote_node_registration_tokens_hash_unique" ON "remote_node_registration_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "remote_nodes_target_unique" ON "remote_nodes" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "remote_nodes_fingerprint_unique" ON "remote_nodes" USING btree ("fingerprint");