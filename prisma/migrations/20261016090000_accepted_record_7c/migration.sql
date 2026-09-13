-- Board `7c` — the accepted quote record, and the three facts it had nowhere to read.
--
-- The board puts three facts under the *Contact details released* badge: who to
-- call, where to collect or deliver from, and what payment was agreed. The first
-- two were already in the tree. The third was not — `Enquiry.terms_wanted` is what
-- the buyer *asked* for, and an accepted quote is agreement to what was *quoted*.
-- Rendering the ask under a heading that says *agreed* would have been the page
-- inventing a term neither party wrote down.
--
-- So the quote learns its own terms, the enquiry learns the buyer's reference,
-- and a supplier report can carry the enquiry whose thread is its evidence.
--
-- **Additive, and ordered to apply ahead of the code** (`docs/deployments.md`
-- § Ordering): every column is nullable with no default, the enum value is new and
-- written by nothing already deployed, and the unique index is over a column that
-- is null on every existing row. Code already running reads none of it.
--
-- Idempotent throughout, because a migration applied through the Supabase MCP and
-- then recorded is the path production takes, and a second run must be a no-op.

-- ── 1 · How the goods reach the buyer ───────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE "delivery_terms" AS ENUM ('included', 'charged_separately', 'collection');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2 · What the supplier quoted, beside the lines ──────────────────────────
--
-- Null is *Not stated on the quote*, and it stays null on every quote sent before
-- this board: nothing backfills from `enquiry.terms_wanted`, because that would
-- write the buyer's ask into the supplier's answer.

ALTER TABLE "quote"
  ADD COLUMN IF NOT EXISTS "payment_terms" "payment_terms",
  ADD COLUMN IF NOT EXISTS "delivery" "delivery_terms";

-- ── 3 · The buyer's own reference ───────────────────────────────────────────
--
-- A PO number or a job code, in the buyer's words. The length rule is a CHECK
-- rather than a form limit alone: the PDF header prints it on one line, and a
-- limit the database does not hold is a limit the next writer forgets.

ALTER TABLE "enquiry"
  ADD COLUMN IF NOT EXISTS "buyer_reference" TEXT;

DO $$
BEGIN
  ALTER TABLE "enquiry"
    ADD CONSTRAINT "enquiry_buyer_reference_length"
    CHECK ("buyer_reference" IS NULL OR char_length("buyer_reference") BETWEEN 1 AND 40);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4 · A supplier report from the accepted record ──────────────────────────
--
-- `ADD VALUE IF NOT EXISTS` is not transactional on older servers; guarded so a
-- re-run is a no-op either way.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'report_kind' AND e.enumlabel = 'accepted_quote'
  ) THEN
    ALTER TYPE "report_kind" ADD VALUE 'accepted_quote';
  END IF;
END $$;

ALTER TABLE "supplier_report"
  ADD COLUMN IF NOT EXISTS "enquiry_id" TEXT;

-- One report per accepted enquiry. Postgres treats nulls as distinct, so every
-- listing report that carries no enquiry is untouched by this.
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_report_enquiry_id_key"
  ON "supplier_report" ("enquiry_id");

-- `SET NULL`: the finding is about a supplier and outlives the enquiry it came from.
DO $$
BEGIN
  ALTER TABLE "supplier_report"
    ADD CONSTRAINT "supplier_report_enquiry_id_fkey"
    FOREIGN KEY ("enquiry_id") REFERENCES "enquiry" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
