ALTER TYPE "public"."role_mapping_source" ADD VALUE 'application_role';--> statement-breakpoint
DROP INDEX "user_entitlements_active_uq";--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN "source_kind" text DEFAULT 'group' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provisioned_app_roles" jsonb;--> statement-breakpoint
-- Backfill existing (group-sourced) entitlements so their source_ref matches the recomputed
-- group id, avoiding a spurious revoke/re-grant on the next reconciliation.
UPDATE "user_entitlements" SET "source_ref" = "source_group_id"::text WHERE "source_kind" = 'group' AND "source_ref" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_entitlements_active_uq" ON "user_entitlements" USING btree ("user_id","role_key","source_kind",coalesce("source_ref", '')) WHERE "user_entitlements"."revoked_at" is null;