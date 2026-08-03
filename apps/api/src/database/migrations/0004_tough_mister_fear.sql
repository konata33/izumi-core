CREATE TYPE "public"."post_content_migration_state" AS ENUM('native', 'pending', 'failed');--> statement-breakpoint
CREATE TABLE "post_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"source_revision" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"document" jsonb NOT NULL,
	"excerpt" text NOT NULL,
	"section" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"reading_minutes" integer NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"is_live" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_publications_source_revision_positive" CHECK ("post_publications"."source_revision" >= 1),
	CONSTRAINT "post_publications_fields_present" CHECK (btrim("post_publications"."title") <> '' AND
        btrim("post_publications"."slug") <> '' AND
        btrim("post_publications"."content") <> '' AND
        btrim("post_publications"."excerpt") <> '' AND
        btrim("post_publications"."section") <> ''),
	CONSTRAINT "post_publications_reading_minutes_positive" CHECK ("post_publications"."reading_minutes" >= 1)
);
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_published_fields_present";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "document" jsonb;--> statement-breakpoint
UPDATE "posts"
SET "document" = jsonb_build_object(
  'root',
  jsonb_build_object(
    'children',
    jsonb_build_array(
      jsonb_build_object(
        'children',
        CASE
          WHEN "content" = '' THEN '[]'::jsonb
          ELSE jsonb_build_array(
            jsonb_build_object(
              'detail', 0,
              'format', 0,
              'mode', 'normal',
              'style', '',
              'text', "content",
              'type', 'text',
              'version', 1
            )
          )
        END,
        'direction', NULL,
        'format', '',
        'indent', 0,
        'textFormat', 0,
        'textStyle', '',
        'type', 'paragraph',
        'version', 1
      )
    ),
    'direction', NULL,
    'format', '',
    'indent', 0,
    'type', 'root',
    'version', 1
  )
)
WHERE "document" IS NULL;--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "document" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_migration_state" "post_content_migration_state" DEFAULT 'native' NOT NULL;--> statement-breakpoint
UPDATE "posts" SET "content_migration_state" = 'pending';--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "has_unpublished_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "post_publications" ADD CONSTRAINT "post_publications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_publications_one_live_per_post_unique" ON "post_publications" USING btree ("post_id") WHERE "post_publications"."is_live" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "post_publications_live_slug_unique" ON "post_publications" USING btree ("slug") WHERE "post_publications"."is_live" = true;--> statement-breakpoint
CREATE INDEX "post_publications_public_order_index" ON "post_publications" USING btree ("is_live","published_at","created_at","id");--> statement-breakpoint
CREATE INDEX "post_publications_post_history_index" ON "post_publications" USING btree ("post_id","created_at");--> statement-breakpoint
INSERT INTO "post_publications" (
  "id",
  "post_id",
  "source_revision",
  "title",
  "slug",
  "content",
  "document",
  "excerpt",
  "section",
  "tags",
  "reading_minutes",
  "published_at",
  "is_live",
  "created_at"
)
SELECT
  'migration-' || "id",
  "id",
  1,
  "title",
  "slug",
  "content",
  "document",
  "excerpt",
  "section",
  "tags",
  "reading_minutes",
  "published_at",
  true,
  COALESCE("published_at", "updated_at")
FROM "posts"
WHERE "status" = 'published' AND "published_at" IS NOT NULL;--> statement-breakpoint
UPDATE "posts"
SET "has_unpublished_changes" = false
WHERE "status" = 'published';--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_revision_positive" CHECK ("posts"."revision" >= 1);
