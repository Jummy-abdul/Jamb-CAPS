-- =============================================================================
-- CAPS: Row Level Security lockdown + authorization reference data
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Row Level Security
--
-- CAPS reads and writes the database exclusively from server-side code using a
-- privileged connection (which bypasses RLS). Supabase additionally exposes the
-- public schema through its REST API to the `anon` and `authenticated` roles.
-- Enabling RLS with NO policies denies those roles all access, so application
-- data can never be read or modified through the public API with an anon key.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','groups','group_memberships','application_roles','permissions','role_permissions',
    'role_mappings','user_entitlements','user_sessions','oidc_transactions','institutions',
    'programmes','applicants','admission_applications','admission_reviews','admission_decisions',
    'audit_logs','scim_sync_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Revoke table privileges from Supabase's API roles where they exist (defence in depth).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
--> statement-breakpoint

-- Audit trail is append-only: block UPDATE/DELETE on audit_logs at the database level.
CREATE OR REPLACE FUNCTION public.caps_audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.caps_audit_logs_immutable();
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2. Application roles
-- -----------------------------------------------------------------------------
INSERT INTO public.application_roles (key, name, description, sort_order) VALUES
  ('admission_officer', 'Admission Officer',
   'Views applicants and applicant profiles, reviews applications and adds review notes. Cannot approve or reject admissions.', 1),
  ('admission_manager', 'Admission Manager',
   'Reviews applications, approves or rejects admissions, places applications on hold and views reports.', 2),
  ('system_administrator', 'System Administrator',
   'Views all application records, accesses administrative modules, manages application settings and views audit logs.', 3)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 3. Permissions
-- -----------------------------------------------------------------------------
INSERT INTO public.permissions (key, name, description, category) VALUES
  ('dashboard.view',      'View dashboard',             'Access the CAPS dashboard and summary statistics.', 'General'),
  ('applicants.view',     'View applicants',            'Search the applicant directory and open applicant profiles.', 'Admissions'),
  ('applications.review', 'Review applications',        'Start reviews, record recommendations and add review notes.', 'Admissions'),
  ('admissions.approve',  'Approve admissions',         'Issue admission offers.', 'Admissions'),
  ('admissions.reject',   'Reject admissions',          'Reject admission applications.', 'Admissions'),
  ('admissions.hold',     'Place applications on hold', 'Place admission applications on hold.', 'Admissions'),
  ('reports.view',        'View reports',               'View admission statistics and reports.', 'Admissions'),
  ('users.view',          'View user directory',        'View users provisioned from Fixiam.', 'Administration'),
  ('access.view',         'View groups and access',     'View groups, memberships, roles and effective entitlements.', 'Administration'),
  ('access.manage',       'Manage role mappings',       'Create, enable and disable group-to-role mappings.', 'Administration'),
  ('scim.logs.view',      'View SCIM synchronisation logs', 'View inbound SCIM provisioning traffic.', 'Administration'),
  ('audit.view',          'View audit logs',            'View the identity, access and admission audit trail.', 'Administration'),
  ('settings.manage',     'Manage integration settings','View and verify Fixiam integration configuration.', 'Administration')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category;
--> statement-breakpoint

INSERT INTO public.role_permissions (role_key, permission_key) VALUES
  ('admission_officer', 'dashboard.view'),
  ('admission_officer', 'applicants.view'),
  ('admission_officer', 'applications.review'),

  ('admission_manager', 'dashboard.view'),
  ('admission_manager', 'applicants.view'),
  ('admission_manager', 'applications.review'),
  ('admission_manager', 'admissions.approve'),
  ('admission_manager', 'admissions.reject'),
  ('admission_manager', 'admissions.hold'),
  ('admission_manager', 'reports.view'),

  ('system_administrator', 'dashboard.view'),
  ('system_administrator', 'applicants.view'),
  ('system_administrator', 'reports.view'),
  ('system_administrator', 'users.view'),
  ('system_administrator', 'access.view'),
  ('system_administrator', 'access.manage'),
  ('system_administrator', 'scim.logs.view'),
  ('system_administrator', 'audit.view'),
  ('system_administrator', 'settings.manage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4. Default group-to-role mappings (configuration, editable by administrators).
-- Groups are NOT created here: they are created dynamically by Fixiam over SCIM
-- and matched to roles by display name (case-insensitive).
-- -----------------------------------------------------------------------------
INSERT INTO public.role_mappings (source_type, source_value, role_key, description, created_by) VALUES
  ('group_display_name', 'CAPS Admission Officers',     'admission_officer',    'Default mapping', 'system'),
  ('group_display_name', 'CAPS Admission Managers',     'admission_manager',    'Default mapping', 'system'),
  ('group_display_name', 'CAPS System Administrators',  'system_administrator', 'Default mapping', 'system')
ON CONFLICT DO NOTHING;
