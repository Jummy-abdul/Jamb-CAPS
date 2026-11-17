-- =============================================================================
-- CAPS · Incremental update — email uniqueness for OIDC email matching
-- Run this in the Supabase SQL Editor on a database that already has 01_schema.sql
-- (migrations 0000 and 0001) applied. Safe to run once; it is a no-op if already present.
-- =============================================================================
begin;

-- 1. Enforce email uniqueness among live, Fixiam-provisioned (SCIM) users.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_scim_live_uq"
  ON "users" USING btree (lower("email"))
  WHERE "deleted_at" is null and "email" is not null and "provisioning_source" = 'scim';

-- 2. Record migration 0002 so a later `npm run db:migrate` recognises it as applied.
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'a0a9578c50c1078e5b638274654adbd3c36d43ddc949c2872d5b318585e20cfb', 1794920866224
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'a0a9578c50c1078e5b638274654adbd3c36d43ddc949c2872d5b318585e20cfb');

commit;

select 'email uniqueness applied' as result,
       to_regclass('public.users_email_scim_live_uq') is not null as index_present,
       (select count(*) from drizzle.__drizzle_migrations) as migrations_recorded;
