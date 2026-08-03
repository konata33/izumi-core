DROP INDEX "owners_email_unique";--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "owners" SET "username" = lower(split_part("email", '@', 1));--> statement-breakpoint
ALTER TABLE "owners" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "owners_username_unique" ON "owners" USING btree ("username");--> statement-breakpoint
ALTER TABLE "owners" DROP COLUMN "email";
