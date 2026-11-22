-- Append-only v2 (fork): persist injected context rows alongside real messages.
-- Injected rows must carry `source_key`; real rows must not.
ALTER TABLE "public"."messages" ADD COLUMN IF NOT EXISTS "is_injection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."messages" ADD COLUMN IF NOT EXISTS "source_key" text;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'messages_injection_source_key_check'
			AND conrelid = 'public.messages'::regclass
	) THEN
		ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_injection_source_key_check" CHECK ("is_injection" = ("source_key" IS NOT NULL));
	END IF;
END $$;
