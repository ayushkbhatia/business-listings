-- Close PostgREST off from the application schema.
--
-- Supabase publishes every table in `public` through PostgREST, and the
-- publishable key is by design shipped to the browser. Before this migration,
-- `GET /rest/v1/quote_line` with that key returned live unit prices — the one
-- table CLAUDE.md says is private to one buyer and one seller. Enquiries,
-- messages, users and the audit log were equally readable.
--
-- This platform does not use PostgREST. Every read and write goes through
-- Prisma on the server, as the `postgres` role, which carries BYPASSRLS. So the
-- fix is deny-by-default rather than a policy per table: enable RLS everywhere
-- with no policies at all, and revoke the grants PostgREST relies on.
--
-- If a future surface genuinely needs direct client access — realtime on a
-- message thread is the plausible one — it gets an explicit, reviewed policy.
-- Nothing is reachable by accident.

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- Future objects created by postgres inherit the same denial.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;

-- A new Prisma model must not be able to arrive unprotected. Every future
-- CREATE TABLE in public gets RLS enabled the moment it is created, so this
-- migration is the last time anyone has to remember.
CREATE OR REPLACE FUNCTION public.enable_rls_on_new_table()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.object_type = 'table' AND obj.schema_name = 'public' THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
    END IF;
  END LOOP;
END $$;

DROP EVENT TRIGGER IF EXISTS enable_rls_on_new_table_trigger;
CREATE EVENT TRIGGER enable_rls_on_new_table_trigger
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS')
  EXECUTE FUNCTION public.enable_rls_on_new_table();

-- Advisory from the previous migration: pin the search_path on the recipient
-- limit trigger so it cannot be hijacked by a schema earlier on the path.
CREATE OR REPLACE FUNCTION public.enquiry_recipient_limit()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (SELECT count(*) FROM public."enquiry_recipient" WHERE "enquiry_id" = NEW."enquiry_id") > 8 THEN
    RAISE EXCEPTION 'An enquiry may reach at most 8 businesses';
  END IF;
  RETURN NULL;
END $$;
