CREATE TABLE IF NOT EXISTS "user_execution_target_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source_client_id" uuid NOT NULL,
	"agent_id" text,
	"topic_id" text,
	"execution_target" text NOT NULL,
	"bound_device_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_execution_target_preferences_scope_check" CHECK (("user_execution_target_preferences"."agent_id" IS NULL) <> ("user_execution_target_preferences"."topic_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "user_execution_target_preferences" DROP CONSTRAINT IF EXISTS "user_execution_target_preferences_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_execution_target_preferences" ADD CONSTRAINT "user_execution_target_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_execution_target_preferences" DROP CONSTRAINT IF EXISTS "user_execution_target_preferences_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_execution_target_preferences" ADD CONSTRAINT "user_execution_target_preferences_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_execution_target_preferences" DROP CONSTRAINT IF EXISTS "user_execution_target_preferences_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "user_execution_target_preferences" ADD CONSTRAINT "user_execution_target_preferences_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_execution_target_preferences_agent_scope_unique" ON "user_execution_target_preferences" USING btree ("user_id","source_client_id","agent_id") WHERE "user_execution_target_preferences"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_execution_target_preferences_topic_scope_unique" ON "user_execution_target_preferences" USING btree ("user_id","source_client_id","topic_id") WHERE "user_execution_target_preferences"."topic_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_execution_target_preferences_agent_id_idx" ON "user_execution_target_preferences" USING btree ("agent_id") WHERE "user_execution_target_preferences"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_execution_target_preferences_topic_id_idx" ON "user_execution_target_preferences" USING btree ("topic_id") WHERE "user_execution_target_preferences"."topic_id" IS NOT NULL;
