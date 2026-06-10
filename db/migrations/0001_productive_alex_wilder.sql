CREATE TABLE "artifacts" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" text NOT NULL
);
