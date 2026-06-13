CREATE TABLE "call_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "call_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"handle" text NOT NULL,
	"shortcode" text NOT NULL,
	"reason" text NOT NULL,
	"reporter_hash" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_handle_shortcode_calls_handle_shortcode_fk" FOREIGN KEY ("handle","shortcode") REFERENCES "public"."calls"("handle","shortcode") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_reports_dedupe_idx" ON "call_reports" USING btree ("handle","shortcode","reporter_hash");--> statement-breakpoint
CREATE INDEX "call_reports_call_idx" ON "call_reports" USING btree ("handle","shortcode");