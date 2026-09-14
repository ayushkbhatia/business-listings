-- Board `7c` — nothing is sent on an enquiry once a quote on it is accepted.
--
-- `lib/quote/fence.ts` is the rule and every writer asks it under the enquiry's
-- row lock (`lockQuoteFence`), so no deployed path writes what this refuses.
-- This is the same rule held by the database, for the writer that has not been
-- written yet: a script, a backfill, a new service that forgets to ask. The
-- accepted record is the terminal state, and a quote that reaches the buyer
-- after it — a new one, a lost one revived, a revision, a window pushed out —
-- makes that record stop being the last word.
--
-- What counts as sending, on a row whose enquiry has a released contact:
--
--   - an INSERT whose status is `sent` or `read`;
--   - an UPDATE into `sent` or `read` from any other status (draft promoted,
--     lost revived);
--   - an UPDATE of a `sent` or `read` quote that changes `sent_at` or
--     `revision`, moves `expires_at` later, or moves it to another enquiry.
--
-- What is not: marking a quote read (status `sent` → `read`, nothing else),
-- acceptance itself (→ `accepted`, → `lost`), drafts, and everything on an
-- enquiry nobody has accepted. The winner's superseded revisions stay `sent`
-- after acceptance and may still be read; they may not be extended.
--
-- Rows already in that shape are not touched: a trigger reads writes, not the
-- table.
--
-- Concurrency stays the application's: the trigger reads the enquiry without a
-- lock, because taking one here would order a read receipt's row locks against
-- acceptance's and deadlock the two. `lockQuoteFence` is what serialises a send
-- against an accept; this is what refuses a writer that skipped it.
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

CREATE OR REPLACE FUNCTION "quote_not_sent_after_acceptance"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  released TEXT;
BEGIN
  IF NEW."status" NOT IN ('sent', 'read') THEN
    RETURN NEW;
  END IF;

  -- A live quote that stays live and says nothing new: a read receipt, a
  -- supersede stamp, an attachment. Not a send.
  IF TG_OP = 'UPDATE'
     AND OLD."status" IN ('sent', 'read')
     AND NEW."enquiry_id" = OLD."enquiry_id"
     AND NEW."sent_at" IS NOT DISTINCT FROM OLD."sent_at"
     AND NEW."revision" IS NOT DISTINCT FROM OLD."revision"
     AND (NEW."expires_at" IS NOT DISTINCT FROM OLD."expires_at"
          OR (OLD."expires_at" IS NOT NULL AND NEW."expires_at" IS NOT NULL AND NEW."expires_at" <= OLD."expires_at"))
  THEN
    RETURN NEW;
  END IF;

  SELECT "contact_released_to_business_id" INTO released
  FROM "enquiry"
  WHERE "id" = NEW."enquiry_id";

  IF released IS NOT NULL THEN
    RAISE EXCEPTION 'enquiry % has an accepted quote; nothing more is sent on it', NEW."enquiry_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "quote_not_sent_after_acceptance" ON "quote";
CREATE TRIGGER "quote_not_sent_after_acceptance"
  BEFORE INSERT OR UPDATE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION "quote_not_sent_after_acceptance"();

-- Callable only by its trigger, as the 7c-s triggers are.
REVOKE ALL ON FUNCTION public.quote_not_sent_after_acceptance() FROM PUBLIC, anon, authenticated;
