ALTER TABLE "ai_sessions" DROP CONSTRAINT "ai_sessions_provider_profile_id_ai_provider_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_provider_profile_id_ai_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."ai_provider_profiles"("id") ON DELETE restrict ON UPDATE no action;