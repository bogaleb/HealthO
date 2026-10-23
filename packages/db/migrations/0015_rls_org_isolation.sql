-- Phase 9 / WP1: PostgreSQL row-level security as a second wall behind the application's organization scoping.
-- Enforced for the least-privilege runtime role (projectos_app); table owners (migrations, seeds, drills) are not
-- subject to RLS (no FORCE). The runtime role is bound to its organization with
--   ALTER ROLE projectos_app IN DATABASE <db> SET app.org_id = '<organization uuid>'   (infra/sql/app-role.sql)
-- and a future multi-tenant runtime would override it per transaction with SET LOCAL app.org_id.
-- With no (or an empty) app.org_id, every policy is false: fail closed.

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
-- Enable RLS + one isolation policy on a tenant table. Future migrations that add a table with organization_id call
-- this (the integration test "every organization table has RLS" fails otherwise).
CREATE OR REPLACE FUNCTION app_enable_org_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  nullable boolean;
BEGIN
  SELECT NOT a.attnotnull INTO nullable FROM pg_attribute a WHERE a.attrelid = tbl AND a.attname = 'organization_id' AND NOT a.attisdropped;
  IF nullable IS NULL THEN
    RAISE EXCEPTION 'table % has no organization_id column', tbl;
  END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %s', tbl);
  IF nullable THEN
    -- System rows (organization_id NULL: platform audit events, global jobs, drills) stay readable/writable.
    EXECUTE format('CREATE POLICY org_isolation ON %s USING (organization_id IS NULL OR organization_id = app_current_org()) WITH CHECK (organization_id IS NULL OR organization_id = app_current_org())', tbl);
  ELSE
    EXECUTE format('CREATE POLICY org_isolation ON %s USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())', tbl);
  END IF;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
  LOOP
    PERFORM app_enable_org_rls(format('public.%I', t.table_name)::regclass);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON organizations USING (id = app_current_org()) WITH CHECK (id = app_current_org());
