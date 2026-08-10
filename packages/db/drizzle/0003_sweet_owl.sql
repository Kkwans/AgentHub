CREATE TABLE "browser_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"singleton_key" text DEFAULT 'PRIMARY' NOT NULL,
	"username" text NOT NULL,
	"normalized_username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'ADMIN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_accounts_singleton_check" CHECK ("local_accounts"."singleton_key" = 'PRIMARY'),
	CONSTRAINT "local_accounts_role_check" CHECK ("local_accounts"."role" = 'ADMIN')
);
--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_account_id_local_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."local_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "browser_sessions_token_hash_unique" ON "browser_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "browser_sessions_account_idx" ON "browser_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "browser_sessions_expires_idx" ON "browser_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "local_accounts_singleton_unique" ON "local_accounts" USING btree ("singleton_key");--> statement-breakpoint
CREATE UNIQUE INDEX "local_accounts_username_unique" ON "local_accounts" USING btree ("normalized_username");