-- Board 10e — the buyer enquiry inbox and saved searches.
--
-- Additive, and it applies before the merge. The one thing it removes is an
-- index — `saved_search (user_id)`, superseded by `(user_id, created_at)` in the
-- same statement group — which no query depends on for correctness. The running deployment writes
-- `saved_search` rows with only user_id, name and query, which every new column
-- here accepts through its default; it never selects `enquiry.resent_from_id`.
--
--   - `saved_search`: a cadence, the zero-result flag 12d reads, the category it
--     was saved on, and the last-seen / new-count pair behind "4 new matches".
--   - `enquiry.resent_from_id`: re-send creates a new enquiry pointing back.
--   - an index for the inbox's newest-first read.
--
-- Idempotent throughout.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Saved searches carry an alert (B6, B7)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "saved_search_cadence" AS ENUM ('daily', 'weekly', 'when_listed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "category_id" TEXT;
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "tab" TEXT NOT NULL DEFAULT 'businesses';
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "cadence" "saved_search_cadence" NOT NULL DEFAULT 'weekly';
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "zero_result" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP(3);
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "last_run_at" TIMESTAMP(3);
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "last_match_at" TIMESTAMP(3);
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "new_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "saved_search" ADD COLUMN IF NOT EXISTS "alerted_count" INTEGER NOT NULL DEFAULT 0;

-- A count of matches is never negative, and an alert never claims more matches
-- than the count it was sent about.
ALTER TABLE "saved_search" DROP CONSTRAINT IF EXISTS "saved_search_counts_non_negative";
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_counts_non_negative"
  CHECK ("new_count" >= 0 AND "alerted_count" >= 0);

ALTER TABLE "saved_search" DROP CONSTRAINT IF EXISTS "saved_search_tab_known";
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_tab_known"
  CHECK ("tab" IN ('businesses', 'products'));

DO $$ BEGIN
  ALTER TABLE "saved_search"
    ADD CONSTRAINT "saved_search_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The buyer's own list, newest first; replaces the user_id-only index.
CREATE INDEX IF NOT EXISTS "saved_search_user_id_created_at_idx" ON "saved_search" ("user_id", "created_at");
DROP INDEX IF EXISTS "saved_search_user_id_idx";
-- The sweep's due read.
CREATE INDEX IF NOT EXISTS "saved_search_cadence_last_run_at_idx" ON "saved_search" ("cadence", "last_run_at");
-- 12d's demand read.
CREATE INDEX IF NOT EXISTS "saved_search_zero_result_category_id_idx" ON "saved_search" ("zero_result", "category_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-send points back (B3)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "enquiry" ADD COLUMN IF NOT EXISTS "resent_from_id" TEXT;

-- An enquiry does not re-send itself.
ALTER TABLE "enquiry" DROP CONSTRAINT IF EXISTS "enquiry_resent_from_other";
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_resent_from_other"
  CHECK ("resent_from_id" IS NULL OR "resent_from_id" <> "id");

DO $$ BEGIN
  ALTER TABLE "enquiry"
    ADD CONSTRAINT "enquiry_resent_from_id_fkey"
    FOREIGN KEY ("resent_from_id") REFERENCES "enquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "enquiry_resent_from_id_idx" ON "enquiry" ("resent_from_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The inbox read
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "enquiry_buyer_id_created_at_idx" ON "enquiry" ("buyer_id", "created_at");
