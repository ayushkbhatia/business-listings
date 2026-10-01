-- Board `1o` — accepting one enquiry's lines from several suppliers, as the
-- owner decided it on 1 Oct 2026 (D1–D7). Columns on rows that already exist,
-- and no new table: `acceptQuote` creates no other row, and neither does this.
--
-- ## Ordering
--
-- **Additive, and applies before the merge.** Every column is nullable or has a
-- default the deployed code never reads. The backfill and the mirror trigger
-- keep `enquiry_recipient.contact_released_at` true for acceptances the
-- deployed code makes in the window before the merge.
--
-- The two index swaps drop something, which `docs/deployments.md` would
-- normally send to a contract migration after the merge. They stay here because
-- each one loosens a constraint rather than removing one anything reads: one
-- review (or report) per enquiry becomes one per enquiry and supplier, built
-- before the old index goes. The deployed code creates both rows with `create`
-- and has no upsert or `ON CONFLICT` on either `enquiry_id` (checked on
-- `origin/main`; `review_draft`'s upsert targets its own index, untouched
-- here). What it loses is only a backstop: two tabs reviewing two different
-- suppliers of one unsplit enquiry in the same instant, which its own gate
-- refuses a moment earlier. Two tabs on the same supplier still meet the new
-- index, which its `P2002` catch reads as already reviewed.
--
-- Idempotent throughout, so a second run is a no-op.

-- ── 1 · D1: the supplier opts in, per quote ────────────────────────────────

ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "allows_partial" BOOLEAN NOT NULL DEFAULT false;

-- The buyer chooses against it, so it cannot move under them. A supplier who
-- wants it the other way sends a revision, which the buyer sees arrive.
CREATE OR REPLACE FUNCTION "quote_allows_partial_fixed"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD."status" <> 'draft' AND NEW."allows_partial" IS DISTINCT FROM OLD."allows_partial" THEN
    RAISE EXCEPTION 'quote %: whether its prices hold for part of it is fixed once sent', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "quote_allows_partial_fixed" ON "quote";
CREATE TRIGGER "quote_allows_partial_fixed"
  BEFORE UPDATE OF "allows_partial" ON "quote"
  FOR EACH ROW EXECUTE FUNCTION "quote_allows_partial_fixed"();

-- ── 2 · D5: the buyer's PO number, per supplier ────────────────────────────

ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "buyer_reference" TEXT;

-- ── 3 · D2, D3, D7: the lines an acceptance covers ─────────────────────────

ALTER TABLE "quote_line" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3);

-- ── 4 · D4: the buyer's contact, released to each accepted supplier ────────

ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "contact_released_at" TIMESTAMP(3);

-- The review request panel and a seller's own accepted enquiries ask "released
-- to this business, since when" — `enquiry_accepted_idx`'s question, per row.
CREATE INDEX IF NOT EXISTS "enquiry_recipient_released_idx"
  ON "enquiry_recipient" ("business_id", "contact_released_at");

-- Every acceptance made before this names one supplier on the enquiry. A
-- release with no time on it is still a release; it takes the migration's.
UPDATE "enquiry_recipient" r
   SET "contact_released_at" = COALESCE(e."contact_released_at", CURRENT_TIMESTAMP)
  FROM "enquiry" e
 WHERE e."id" = r."enquiry_id"
   AND e."contact_released_to_business_id" = r."business_id"
   AND r."contact_released_at" IS NULL;

-- And every acceptance written the old way after it — the deployed code in the
-- window before the merge, or anything else that sets the enquiry's column —
-- reaches the recipient row too. A split writes each recipient itself.
CREATE OR REPLACE FUNCTION "enquiry_release_reaches_recipient"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."contact_released_to_business_id" IS NOT NULL
     AND NEW."contact_released_to_business_id" IS DISTINCT FROM OLD."contact_released_to_business_id" THEN
    UPDATE "enquiry_recipient"
       SET "contact_released_at" = COALESCE(NEW."contact_released_at", CURRENT_TIMESTAMP)
     WHERE "enquiry_id" = NEW."id"
       AND "business_id" = NEW."contact_released_to_business_id"
       AND "contact_released_at" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "enquiry_release_reaches_recipient" ON "enquiry";
CREATE TRIGGER "enquiry_release_reaches_recipient"
  AFTER UPDATE OF "contact_released_to_business_id" ON "enquiry"
  FOR EACH ROW EXECUTE FUNCTION "enquiry_release_reaches_recipient"();

-- The other order: an enquiry written already released — the seed does this,
-- and so would any import — before its recipients exist. The row is stamped
-- as it arrives, so the two columns agree whichever is written first.
CREATE OR REPLACE FUNCTION "recipient_arrives_released"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."contact_released_at" IS NULL THEN
    SELECT COALESCE(e."contact_released_at", CURRENT_TIMESTAMP) INTO NEW."contact_released_at"
      FROM "enquiry" e
     WHERE e."id" = NEW."enquiry_id"
       AND e."contact_released_to_business_id" = NEW."business_id";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "recipient_arrives_released" ON "enquiry_recipient";
CREATE TRIGGER "recipient_arrives_released"
  BEFORE INSERT ON "enquiry_recipient"
  FOR EACH ROW EXECUTE FUNCTION "recipient_arrives_released"();

-- ── 5 · D5: a request to accept a split, asked once ────────────────────────

ALTER TABLE "quote_approval" ADD COLUMN IF NOT EXISTS "split" JSONB;

-- `20261108090000_buyer_company_7b`'s rule, with the split added to what is
-- fixed once asked. Everything else is as it was.
CREATE OR REPLACE FUNCTION "quote_approval_is_the_request"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW."company_id" IS DISTINCT FROM OLD."company_id"
     OR NEW."enquiry_id" IS DISTINCT FROM OLD."enquiry_id"
     OR NEW."quote_id" IS DISTINCT FROM OLD."quote_id"
     OR NEW."quote_revision" IS DISTINCT FROM OLD."quote_revision"
     OR NEW."value_fils" IS DISTINCT FROM OLD."value_fils"
     OR NEW."split" IS DISTINCT FROM OLD."split"
     OR NEW."raised_by_id" IS DISTINCT FROM OLD."raised_by_id"
     OR NEW."reasons" IS DISTINCT FROM OLD."reasons"
     OR NEW."approver_id" IS DISTINCT FROM OLD."approver_id"
     OR NEW."po_number" IS DISTINCT FROM OLD."po_number"
     OR NEW."cost_code" IS DISTINCT FROM OLD."cost_code"
     OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'quote_approval %: what was asked for is fixed once asked', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('approved', 'withdrawn', 'superseded') THEN
    RAISE EXCEPTION 'quote_approval % is % and is not reopened', OLD."id", OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'pending' AND NEW."status" IN ('approved', 'queried', 'withdrawn', 'superseded'))
    OR (OLD."status" = 'queried' AND NEW."status" IN ('pending', 'withdrawn', 'superseded'))
  ) THEN
    RAISE EXCEPTION 'quote_approval %: % cannot become %', OLD."id", OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 6 · D6: one review per enquiry and supplier ────────────────────────────

-- Built before the old one goes, so there is no instant with neither.
CREATE UNIQUE INDEX IF NOT EXISTS "review_enquiry_id_business_id_key" ON "review" ("enquiry_id", "business_id");
DROP INDEX IF EXISTS "review_enquiry_id_key";

-- ── 7 · D4: a report per supplier accepted from ────────────────────────────

-- The record is one per supplier after a split, and so is the report filed
-- from it. Public reports carry no enquiry; a null is never equal to a null,
-- so they stay unconstrained as before.
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_report_enquiry_id_subject_business_id_key"
  ON "supplier_report" ("enquiry_id", "subject_business_id");
DROP INDEX IF EXISTS "supplier_report_enquiry_id_key";

-- ── 8 · No caller but the triggers ─────────────────────────────────────────

-- As every trigger function since `20260823175500_harden_event_trigger_fn`.
REVOKE ALL ON FUNCTION public.quote_allows_partial_fixed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enquiry_release_reaches_recipient() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recipient_arrives_released() FROM PUBLIC, anon, authenticated;
