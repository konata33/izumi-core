CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_message_status" AS ENUM('complete', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_type" AS ENUM('claude', 'openai-compatible');--> statement-breakpoint
CREATE TYPE "public"."ai_tool_decision" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"kind" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"public_url" text NOT NULL,
	"width" integer,
	"height" integer,
	"thumbhash" text,
	"alt" text,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "media_assets_public_url_unique" UNIQUE("public_url"),
	CONSTRAINT "media_assets_status_check" CHECK ("media_assets"."status" IN ('initiated', 'ready')),
	CONSTRAINT "media_assets_kind_check" CHECK ("media_assets"."kind" IN ('image', 'video')),
	CONSTRAINT "media_assets_byte_size_positive" CHECK ("media_assets"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "post_media_references" (
	"post_id" text NOT NULL,
	"asset_id" text NOT NULL,
	CONSTRAINT "post_media_references_post_id_asset_id_pk" PRIMARY KEY("post_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"status" "ai_message_status" DEFAULT 'complete' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"provider_type" "ai_provider_type" NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"post_id" text NOT NULL,
	"title" text NOT NULL,
	"provider_profile_id" text,
	"active_run_id" text,
	"active_run_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_sessions_active_run_pair_check" CHECK (("ai_sessions"."active_run_id" IS NULL) = ("ai_sessions"."active_run_started_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ai_tool_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"decision" "ai_tool_decision" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media_references" ADD CONSTRAINT "post_media_references_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media_references" ADD CONSTRAINT "post_media_references_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_profiles" ADD CONSTRAINT "ai_provider_profiles_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_provider_profile_id_ai_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."ai_provider_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_decisions" ADD CONSTRAINT "ai_tool_decisions_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_owner_created_index" ON "media_assets" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_orphan_index" ON "media_assets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_session_created_index" ON "ai_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_profiles_owner_name_unique" ON "ai_provider_profiles" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "ai_sessions_post_updated_index" ON "ai_sessions" USING btree ("post_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tool_decisions_session_call_unique" ON "ai_tool_decisions" USING btree ("session_id","tool_call_id");