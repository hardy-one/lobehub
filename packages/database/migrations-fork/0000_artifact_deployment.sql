-- Repair the upstream migration skipped by instances that recorded the old fork migration later.
CREATE TABLE IF NOT EXISTS "linear_sync_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"team_id" varchar(255) NOT NULL,
	"team_name" varchar(255) NOT NULL,
	"linear_project_id" varchar(255),
	"linear_project_name" varchar(255),
	"state_types" jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_result" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"external_identifier" varchar(255) NOT NULL,
	"external_url" text NOT NULL,
	"external_container_id" varchar(255),
	"external_updated_at" timestamp with time zone,
	"synced_hash" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_connection_id_linear_connections_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_connection_id_linear_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."linear_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_external_links" DROP CONSTRAINT IF EXISTS "task_external_links_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_external_links" ADD CONSTRAINT "task_external_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_external_links" DROP CONSTRAINT IF EXISTS "task_external_links_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_external_links" ADD CONSTRAINT "task_external_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_external_links" DROP CONSTRAINT IF EXISTS "task_external_links_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_external_links" ADD CONSTRAINT "task_external_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_project_id_idx" ON "linear_sync_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_connection_id_idx" ON "linear_sync_rules" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_user_id_idx" ON "linear_sync_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_workspace_id_idx" ON "linear_sync_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_external_links_task_id_unique" ON "task_external_links" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_external_links_personal_unique" ON "task_external_links" USING btree ("user_id","provider","external_id") WHERE "task_external_links"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_external_links_workspace_unique" ON "task_external_links" USING btree ("workspace_id","provider","external_id") WHERE "task_external_links"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_external_links_container_idx" ON "task_external_links" USING btree ("provider","external_container_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_external_links_user_id_idx" ON "task_external_links" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifact_deployment_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" varchar(64) NOT NULL,
	"revision" integer NOT NULL,
	"object_prefix" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"total_bytes" integer NOT NULL,
	"file_count" integer NOT NULL,
	"source" text,
	"content_hash" text,
	"build_ms" integer,
	"message_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifact_deployments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"topic_id" text NOT NULL,
	"identifier" text NOT NULL,
	"title" text,
	"kind" text DEFAULT 'html' NOT NULL,
	"slug" text,
	"status" text DEFAULT 'published' NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"entry" text DEFAULT 'index.html' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_deployment_revisions" DROP CONSTRAINT IF EXISTS "artifact_deployment_revisions_deployment_id_artifact_deployments_id_fk";--> statement-breakpoint
ALTER TABLE "artifact_deployment_revisions" ADD CONSTRAINT "artifact_deployment_revisions_deployment_id_artifact_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."artifact_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deployments" DROP CONSTRAINT IF EXISTS "artifact_deployments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artifact_deployments" ADD CONSTRAINT "artifact_deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deployments" DROP CONSTRAINT IF EXISTS "artifact_deployments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artifact_deployments" ADD CONSTRAINT "artifact_deployments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artifact_deployment_revisions_deployment_id_revision_unique" ON "artifact_deployment_revisions" USING btree ("deployment_id","revision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_deployment_revisions_deployment_id_idx" ON "artifact_deployment_revisions" USING btree ("deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artifact_deployments_user_id_topic_id_identifier_unique" ON "artifact_deployments" USING btree ("user_id","topic_id","identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_deployments_user_id_idx" ON "artifact_deployments" USING btree ("user_id");
