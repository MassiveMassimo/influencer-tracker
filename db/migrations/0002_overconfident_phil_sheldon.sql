CREATE TABLE "call_overrides" (
	"handle" text NOT NULL,
	"shortcode" text NOT NULL,
	"ticker" text,
	"is_explicit_buy" boolean,
	"direction" text,
	"reason" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "call_overrides_handle_shortcode_pk" PRIMARY KEY("handle","shortcode")
);
--> statement-breakpoint
ALTER TABLE "call_overrides" ADD CONSTRAINT "call_overrides_handle_creators_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."creators"("handle") ON DELETE cascade ON UPDATE no action;