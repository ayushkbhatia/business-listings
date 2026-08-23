-- The RLS event-trigger function was left callable over PostgREST as
-- SECURITY DEFINER. It cannot do anything useful when invoked directly —
-- pg_event_trigger_ddl_commands() errors outside an event trigger — but a
-- definer-rights function on the public API surface is the wrong default and
-- the next one might not be harmless.
--
-- An event trigger fires as the role running the DDL, which is postgres, so
-- definer rights were never needed.

CREATE OR REPLACE FUNCTION public.enable_rls_on_new_table()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
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

REVOKE ALL ON FUNCTION public.enable_rls_on_new_table() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enquiry_recipient_limit() FROM PUBLIC, anon, authenticated;
