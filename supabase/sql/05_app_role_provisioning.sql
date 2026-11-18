-- =============================================================================
-- CAPS · Incremental update — Fixiam application-role provisioning (migration 0003)
-- Run in the Supabase SQL Editor on a database that already has 01_schema.sql +
-- 04_email_uniqueness.sql applied. Idempotent; safe to run once.
--
-- Adds: role_mapping_source value 'application_role'; users.provisioned_app_roles;
-- user_entitlements.source_kind / source_ref (+ reworked uniqueness index); and the
-- default external-role → internal-role mappings for the demo.
-- =============================================================================

-- NOTE: ALTER TYPE ... ADD VALUE must run OUTSIDE a transaction block because the new
-- value is used later in this same script (PostgreSQL forbids using a freshly added enum
-- value inside the transaction that added it). This statement is idempotent on its own.
ALTER TYPE "public"."role_mapping_source" ADD VALUE IF NOT EXISTS 'application_role';

begin;

-- 1. First-class storage for Fixiam-provisioned application roles.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "provisioned_app_roles" jsonb;

-- 2. Entitlement source discriminator (group vs application_role).
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "source_kind" text NOT NULL DEFAULT 'group';
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "source_ref" text;

-- 3. Backfill existing group entitlements so their source_ref matches the recomputed group id
--    (prevents a spurious revoke/re-grant on the next reconciliation).
UPDATE "user_entitlements"
   SET "source_ref" = "source_group_id"::text
 WHERE "source_kind" = 'group' AND "source_ref" IS NULL;

-- 4. One active grant per (user, role, source). A role conferred by both a group and an
--    application role is two distinct rows; both must be removed to lose the role.
DROP INDEX IF EXISTS "user_entitlements_active_uq";
CREATE UNIQUE INDEX "user_entitlements_active_uq"
  ON "user_entitlements" USING btree ("user_id","role_key","source_kind",coalesce("source_ref", ''))
  WHERE "revoked_at" is null;

-- 5. Default application-role mappings (external Fixiam value → internal CAPS role).
--    CAPS owns this mapping; Fixiam owns the assignment. Add/disable more via Settings.
INSERT INTO public.role_mappings (source_type, source_value, role_key, description, created_by) VALUES
  ('application_role', 'admission_officer',      'admission_officer',      'Default Fixiam application-role mapping', 'system'),
  ('application_role', 'admission_manager',      'admission_manager',      'Default Fixiam application-role mapping', 'system'),
  ('application_role', 'system_administrator',   'system_administrator',   'Default Fixiam application-role mapping', 'system')
ON CONFLICT DO NOTHING;

-- 6. Record migration 0003 so a later `npm run db:migrate` recognises it as applied.
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '9321545e5bb24ca8c979fea713b15d3ee5ad49cdabd8625ea863d22209a579f1', 1794986902843
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '9321545e5bb24ca8c979fea713b15d3ee5ad49cdabd8625ea863d22209a579f1');

commit;

select 'application-role provisioning applied' as result,
       (select count(*) from information_schema.columns where table_name='users' and column_name='provisioned_app_roles') = 1 as users_column_present,
       (select count(*) from information_schema.columns where table_name='user_entitlements' and column_name in ('source_kind','source_ref')) = 2 as entitlement_columns_present,
       (select count(*) from public.role_mappings where source_type='application_role') as app_role_mappings,
       (select count(*) from drizzle.__drizzle_migrations) as migrations_recorded;
