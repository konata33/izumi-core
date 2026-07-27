ALTER TABLE "posts" ADD COLUMN "excerpt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "section" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reading_minutes" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_public_order_index" ON "posts" USING btree ("status","published_at","created_at","id");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_reading_minutes_positive" CHECK ("posts"."reading_minutes" >= 1);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_published_fields_present" CHECK ("posts"."status" <> 'published' OR (
        btrim("posts"."title") <> '' AND
        btrim("posts"."slug") <> '' AND
        btrim("posts"."content") <> '' AND
        btrim("posts"."excerpt") <> '' AND
        btrim("posts"."section") <> '' AND
        "posts"."published_at" IS NOT NULL
      )) NOT VALID;
