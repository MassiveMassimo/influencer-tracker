CREATE TABLE "calls" (
	"handle" text NOT NULL,
	"shortcode" text NOT NULL,
	"ord" integer NOT NULL,
	"post_date" text NOT NULL,
	"ticker" text NOT NULL,
	"company" text NOT NULL,
	"is_first_call" boolean NOT NULL,
	"conviction" double precision NOT NULL,
	"quote" text NOT NULL,
	"summary" text,
	"on_screen_price" double precision,
	"spark" jsonb,
	"returns" jsonb NOT NULL,
	CONSTRAINT "calls_handle_shortcode_pk" PRIMARY KEY("handle","shortcode")
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"handle" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"ord" integer NOT NULL,
	"generated_at" text NOT NULL,
	"spy_anchor" text NOT NULL,
	"scorecard" jsonb NOT NULL,
	"caveats" jsonb NOT NULL,
	"index_stats" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"o" double precision NOT NULL,
	"h" double precision NOT NULL,
	"l" double precision NOT NULL,
	"c" double precision NOT NULL,
	CONSTRAINT "prices_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_handle_creators_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."creators"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_ticker_idx" ON "calls" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "calls_post_date_idx" ON "calls" USING btree ("post_date");