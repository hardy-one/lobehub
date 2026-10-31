-- Fork-owned tables live in their own schema so their names and index names can
-- never collide with objects upstream adds to `public`.
CREATE SCHEMA IF NOT EXISTS "hardy";--> statement-breakpoint
DO $$
BEGIN
	IF to_regclass('public.artifact_deployments') IS NOT NULL
		AND to_regclass('hardy.artifact_deployments') IS NULL THEN
		ALTER TABLE "public"."artifact_deployments" SET SCHEMA "hardy";
	END IF;
	IF to_regclass('public.artifact_deployment_revisions') IS NOT NULL
		AND to_regclass('hardy.artifact_deployment_revisions') IS NULL THEN
		ALTER TABLE "public"."artifact_deployment_revisions" SET SCHEMA "hardy";
	END IF;
END $$;
