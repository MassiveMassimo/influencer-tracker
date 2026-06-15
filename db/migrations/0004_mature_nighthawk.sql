-- Multiple stocks per post: the call identity becomes (handle, shortcode, ticker).
-- Hand-ordered (drizzle's generated order added the call_overrides PK before its column
-- and added call_reports.ticker as NOT NULL with no default — both fail on populated
-- tables). The sequence below is safe against a live prod DB.

-- 1. Drop the call_reports FK + indexes that reference the old (handle, shortcode) shape.
ALTER TABLE "call_reports" DROP CONSTRAINT "call_reports_handle_shortcode_calls_handle_shortcode_fk";--> statement-breakpoint
DROP INDEX "call_reports_dedupe_idx";--> statement-breakpoint
DROP INDEX "call_reports_call_idx";--> statement-breakpoint

-- 2. Repoint the calls PK to include ticker. ticker is already NOT NULL on every row, so
-- widening the PK never fails; pre-migration each (handle, shortcode) had one ticker.
ALTER TABLE "calls" DROP CONSTRAINT "calls_handle_shortcode_pk";--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_handle_shortcode_ticker_pk" PRIMARY KEY("handle","shortcode","ticker");--> statement-breakpoint

-- 3. call_overrides: add the discriminator column FIRST, then move the PK onto it.
-- Existing overrides default to '' (legacy whole-post) so they keep applying as before.
ALTER TABLE "call_overrides" ADD COLUMN "target_ticker" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "call_overrides" DROP CONSTRAINT "call_overrides_handle_shortcode_pk";--> statement-breakpoint
ALTER TABLE "call_overrides" ADD CONSTRAINT "call_overrides_handle_shortcode_target_ticker_pk" PRIMARY KEY("handle","shortcode","target_ticker");--> statement-breakpoint

-- 4. call_reports: add ticker nullable, backfill from the (1:1 pre-migration) call it
-- references, then enforce NOT NULL. Any report whose call no longer exists would have
-- been cascade-deleted by the old FK, so the join leaves no NULLs.
ALTER TABLE "call_reports" ADD COLUMN "ticker" text;--> statement-breakpoint
UPDATE "call_reports" r SET "ticker" = c."ticker" FROM "calls" c WHERE r."handle" = c."handle" AND r."shortcode" = c."shortcode";--> statement-breakpoint
ALTER TABLE "call_reports" ALTER COLUMN "ticker" SET NOT NULL;--> statement-breakpoint

-- 5. Re-create the call_reports FK + indexes against the new 3-column calls PK.
ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_handle_shortcode_ticker_calls_handle_shortcode_ticker_fk" FOREIGN KEY ("handle","shortcode","ticker") REFERENCES "public"."calls"("handle","shortcode","ticker") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_reports_dedupe_idx" ON "call_reports" USING btree ("handle","shortcode","ticker","reporter_hash");--> statement-breakpoint
CREATE INDEX "call_reports_call_idx" ON "call_reports" USING btree ("handle","shortcode","ticker");
