ALTER TABLE "artifact_deployments" ADD COLUMN "next_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "artifact_deployments" SET "next_revision" = COALESCE((SELECT MAX("revision") FROM "artifact_deployment_revisions" WHERE "deployment_id" = "artifact_deployments"."id"), 0) + 1;--> statement-breakpoint
