CREATE TABLE "artifact_deployment_revisions" (
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
CREATE TABLE "artifact_deployments" (
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
ALTER TABLE "artifact_deployment_revisions" ADD CONSTRAINT "artifact_deployment_revisions_deployment_id_artifact_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."artifact_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deployments" ADD CONSTRAINT "artifact_deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deployments" ADD CONSTRAINT "artifact_deployments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_deployment_revisions_deployment_id_revision_unique" ON "artifact_deployment_revisions" USING btree ("deployment_id","revision");--> statement-breakpoint
CREATE INDEX "artifact_deployment_revisions_deployment_id_idx" ON "artifact_deployment_revisions" USING btree ("deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_deployments_user_id_topic_id_identifier_unique" ON "artifact_deployments" USING btree ("user_id","topic_id","identifier");--> statement-breakpoint
CREATE INDEX "artifact_deployments_user_id_idx" ON "artifact_deployments" USING btree ("user_id");