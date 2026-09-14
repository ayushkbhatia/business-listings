-- Board `7c-s` — the accepted proposal, held as the record of what was agreed.
--
-- Three things, none of which moves a row that exists:
--
--   1. Two payment terms a services proposal needs and a goods quote does not:
--      *in arrears* and *on completion*. `7c`'s "payment agreed" column read
--      *Not stated* on every accepted proposal, because `3j-s` gave the seller
--      nowhere to say it.
--   2. An accepted quote's agreed terms cannot be edited (acceptance criterion 8,
--      *immutable after acceptance, for both parties*). `quote_proposal_immutable`
--      already holds the proposal row; this holds the quote row it hangs off —
--      the payment terms, the window, the revision and who it was between.
--   3. The brief an accepted proposal answered cannot be edited either. The
--      record's term dates are computed from its start date (`B4`), so an edit
--      to the brief would move the dates on a contract nobody re-signed.
--
-- **Additive, and ordered to apply ahead of the code** (`docs/deployments.md`
-- § Ordering). Enum values nothing deployed writes, and two triggers that refuse
-- only what no deployed path does: no writer updates an accepted quote's terms,
-- and no writer updates a `service_brief` row at all.
--
-- Idempotent throughout: applied through the Supabase MCP and then recorded, a
-- second run must be a no-op.

-- ── 1 · Payment terms for work ──────────────────────────────────────────────
--
-- `ADD VALUE` may run inside a transaction on Postgres 12 and later, as long as
-- nothing in the same transaction uses the new value — nothing here does.

ALTER TYPE "payment_terms" ADD VALUE IF NOT EXISTS 'in_arrears';
ALTER TYPE "payment_terms" ADD VALUE IF NOT EXISTS 'on_completion';

-- ── 2 · An accepted quote's terms are fixed ─────────────────────────────────
--
-- Not `updated_at`, which Prisma stamps on any write, and not the columns a
-- later board may legitimately annotate. Only what the two parties agreed to and
-- the identity of the agreement: a record whose payment terms, window or
-- revision could change after acceptance is not a record.

CREATE OR REPLACE FUNCTION "quote_accepted_terms_fixed"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD."status" = 'accepted' AND (
       NEW."status"         IS DISTINCT FROM OLD."status"
    OR NEW."payment_terms"  IS DISTINCT FROM OLD."payment_terms"
    OR NEW."delivery"       IS DISTINCT FROM OLD."delivery"
    OR NEW."note"           IS DISTINCT FROM OLD."note"
    OR NEW."validity_days"  IS DISTINCT FROM OLD."validity_days"
    OR NEW."sent_at"        IS DISTINCT FROM OLD."sent_at"
    OR NEW."expires_at"     IS DISTINCT FROM OLD."expires_at"
    OR NEW."accepted_at"    IS DISTINCT FROM OLD."accepted_at"
    OR NEW."revision"       IS DISTINCT FROM OLD."revision"
    OR NEW."ref"            IS DISTINCT FROM OLD."ref"
    OR NEW."enquiry_id"     IS DISTINCT FROM OLD."enquiry_id"
    OR NEW."business_id"    IS DISTINCT FROM OLD."business_id"
  ) THEN
    RAISE EXCEPTION 'quote % has been accepted; its terms are the record', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "quote_accepted_terms_fixed" ON "quote";
CREATE TRIGGER "quote_accepted_terms_fixed"
  BEFORE UPDATE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION "quote_accepted_terms_fixed"();

-- ── 3 · The brief behind an accepted enquiry is fixed ───────────────────────

CREATE OR REPLACE FUNCTION "service_brief_fixed_once_accepted"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "enquiry"
    WHERE "id" = OLD."enquiry_id" AND "contact_released_to_business_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'brief % belongs to an accepted enquiry; its dates are the record', OLD."enquiry_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "service_brief_fixed_once_accepted" ON "service_brief";
CREATE TRIGGER "service_brief_fixed_once_accepted"
  BEFORE UPDATE ON "service_brief"
  FOR EACH ROW EXECUTE FUNCTION "service_brief_fixed_once_accepted"();

-- Neither function does anything useful called directly, and neither is the
-- browser's to call — the hardening `quote_proposal_immutable` carries.
REVOKE ALL ON FUNCTION public.quote_accepted_terms_fixed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_brief_fixed_once_accepted() FROM PUBLIC, anon, authenticated;
