CREATE TYPE "public"."profile_link_kind" AS ENUM('github', 'x');--> statement-breakpoint
CREATE TABLE "profile_links" (
	"profile_id" text NOT NULL,
	"kind" "profile_link_kind" NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "profile_links_profile_id_kind_pk" PRIMARY KEY("profile_id","kind")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"singleton_slot" integer DEFAULT 1 NOT NULL,
	"display_name" text NOT NULL,
	"headline" text NOT NULL,
	"bio" text NOT NULL,
	"avatar_url" text NOT NULL,
	"avatar_alt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_fields_present" CHECK (btrim("profiles"."display_name") <> '' AND
        btrim("profiles"."headline") <> '' AND
        btrim("profiles"."bio") <> '' AND
        btrim("profiles"."avatar_url") <> '' AND
        btrim("profiles"."avatar_alt") <> '')
);
--> statement-breakpoint
ALTER TABLE "profile_links" ADD CONSTRAINT "profile_links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_singleton_unique" ON "profiles" USING btree ("singleton_slot");