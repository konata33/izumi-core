CREATE TABLE "storage_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'local' NOT NULL,
	"endpoint" text,
	"region" text,
	"bucket" text,
	"access_key_id" text,
	"encrypted_secret_access_key" text,
	"public_base_url" text,
	"force_path_style" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_settings_mode_check" CHECK ("storage_settings"."mode" IN ('local', 's3'))
);
--> statement-breakpoint
ALTER TABLE "storage_settings" ADD CONSTRAINT "storage_settings_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;