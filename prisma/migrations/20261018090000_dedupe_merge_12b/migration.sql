-- Board 12b, board-level pass. Dedupe & merge — the pairs a machine should not decide.
--
-- `20260826170000_dedupe_merge` built a pair of two listings, a merge that
-- moves everything and deletes nothing, and a thirty-day reversal. This makes a
-- pair the queue the board draws: a record from an import run against the
-- listing it may duplicate, three outcomes that each resolve it, a bulk merge
-- that is one reversible unit, and the owner's say over a branch added to a
-- listing they have claimed.
--
-- Additive, and it applies before the merge. Two CHECKs are replaced by wider
-- ones that every existing row and every write the running deployment makes
-- still satisfies, and `merge_candidate.absorb_id` loses its NOT NULL — which
-- the running deployment never writes as null. New enum values are compared as
-- `::text` in the CHECKs, because a value added by `ALTER TYPE … ADD VALUE`
-- cannot be used as that type in the transaction that adds it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. States
-- ─────────────────────────────────────────────────────────────────────────────

-- A record from a run that became a branch of the listing it duplicated, and
-- one discarded as a source error. Both before `published`, where they read.
ALTER TYPE "staged_disposition" ADD VALUE IF NOT EXISTS 'merged' BEFORE 'published';
ALTER TYPE "staged_disposition" ADD VALUE IF NOT EXISTS 'discarded' BEFORE 'published';

DO $$
BEGIN
  -- B2, B3: three outcomes resolve a pair, and a skip is none of them.
  -- `withdrawn` is a pair nobody decided because it stopped being a question:
  -- a side merged elsewhere, or its run went.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'merge_candidate_state') THEN
    CREATE TYPE "merge_candidate_state" AS ENUM ('pending', 'merged', 'separated', 'discarded', 'withdrawn');
  END IF;
  -- Q2: a branch added to a claimed listing from the manual band waits for the
  -- owner; one from a bulk merge is live and the owner may still reject it.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'owner_confirmation') THEN
    CREATE TYPE "owner_confirmation" AS ENUM ('not_needed', 'awaiting', 'informed', 'confirmed', 'rejected');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A bulk merge, as one unit — B4
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "merge_batch" (
  "id"               TEXT NOT NULL,
  "actor_id"         UUID NOT NULL,
  "reason"           TEXT NOT NULL,
  -- The certain line the batch was taken at, so a later re-tune cannot make
  -- the record say something different about what "above 90%" meant.
  "certain_line"     DOUBLE PRECISION NOT NULL,
  "pair_count"       INTEGER NOT NULL,
  "reversible_until" TIMESTAMP(3) NOT NULL,
  "reversed_at"      TIMESTAMP(3),
  "reversed_by_id"   UUID,
  "reverse_reason"   TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "merge_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "merge_batch_reason_not_blank" CHECK (btrim("reason") <> ''),
  CONSTRAINT "merge_batch_reversal_is_whole" CHECK (
    ("reversed_at" IS NULL AND "reversed_by_id" IS NULL AND "reverse_reason" IS NULL)
    OR
    ("reversed_at" IS NOT NULL AND "reversed_by_id" IS NOT NULL
      AND "reverse_reason" IS NOT NULL AND btrim("reverse_reason") <> '')
  )
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_batch_actor_id_fkey') THEN
    ALTER TABLE "merge_batch"
      ADD CONSTRAINT "merge_batch_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_batch_reversed_by_id_fkey') THEN
    ALTER TABLE "merge_batch"
      ADD CONSTRAINT "merge_batch_reversed_by_id_fkey"
      FOREIGN KEY ("reversed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The pair
-- ─────────────────────────────────────────────────────────────────────────────

-- A pair is two listings, or a record from a run and the listing it may
-- duplicate. The record has no business row to point at, so the second side
-- is one of two columns.
ALTER TABLE "merge_candidate" ALTER COLUMN "absorb_id" DROP NOT NULL;

ALTER TABLE "merge_candidate"
  ADD COLUMN IF NOT EXISTS "staged_listing_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "source_run_id"       TEXT,
  ADD COLUMN IF NOT EXISTS "state"               "merge_candidate_state" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "resolved_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolved_by_id"      UUID,
  ADD COLUMN IF NOT EXISTS "resolution_reason"   TEXT,
  ADD COLUMN IF NOT EXISTS "withdrawn_reason"    TEXT,
  ADD COLUMN IF NOT EXISTS "batch_id"            TEXT,
  -- What a resolution changed that `business_merge` does not record: the
  -- branch location it created, the record's disposition before, a listing's
  -- publish date before a discard. Replayed by a reversal, never recomputed.
  ADD COLUMN IF NOT EXISTS "manifest"            JSONB,
  ADD COLUMN IF NOT EXISTS "reversible_until"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversed_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversed_by_id"      UUID,
  ADD COLUMN IF NOT EXISTS "reverse_reason"      TEXT,
  ADD COLUMN IF NOT EXISTS "owner_confirmation"  "owner_confirmation" NOT NULL DEFAULT 'not_needed',
  ADD COLUMN IF NOT EXISTS "owner_decided_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "owner_decided_by_id" UUID;

-- The decisions already taken, in the new vocabulary. A dismissal was always
-- "not a duplicate", which is what keep-separate is.
UPDATE "merge_candidate"
   SET "state" = 'merged', "resolved_at" = m."created_at", "resolved_by_id" = m."actor_id",
       "resolution_reason" = m."reason", "reversible_until" = m."reversible_until"
  FROM "business_merge" AS m
 WHERE m."id" = "merge_candidate"."merge_id" AND "merge_candidate"."state" = 'pending';

UPDATE "merge_candidate"
   SET "state" = 'separated', "resolved_at" = "dismissed_at", "resolved_by_id" = "dismissed_by_id",
       "resolution_reason" = "dismiss_reason"
 WHERE "dismissed_at" IS NOT NULL AND "state" = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_staged_listing_id_fkey') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_staged_listing_id_fkey"
      FOREIGN KEY ("staged_listing_id") REFERENCES "staged_listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- SET NULL: a run that is deleted outright takes nothing with it but the link.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_source_run_id_fkey') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_source_run_id_fkey"
      FOREIGN KEY ("source_run_id") REFERENCES "licence_import_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_resolved_by_id_fkey') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_resolved_by_id_fkey"
      FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_reversed_by_id_fkey') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_reversed_by_id_fkey"
      FOREIGN KEY ("reversed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_owner_decided_by_id_fkey') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_owner_decided_by_id_fkey"
      FOREIGN KEY ("owner_decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_batch_id_fkey') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "merge_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- One second side, never two and never none.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_one_second_side') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_one_second_side"
      CHECK (("absorb_id" IS NULL) <> ("staged_listing_id" IS NULL));
  END IF;
  -- B6: a resolution names who and why. Pending and withdrawn carry neither.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_resolution_is_whole') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_resolution_is_whole"
      CHECK (
        ("state"::text IN ('pending', 'withdrawn') AND "resolved_at" IS NULL AND "resolution_reason" IS NULL)
        OR
        ("state"::text IN ('merged', 'separated', 'discarded')
          AND "resolved_at" IS NOT NULL AND "resolution_reason" IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_withdrawal_says_why') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_withdrawal_says_why"
      CHECK (("state"::text = 'withdrawn') = ("withdrawn_reason" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_candidate_reversal_is_whole') THEN
    ALTER TABLE "merge_candidate"
      ADD CONSTRAINT "merge_candidate_reversal_is_whole"
      CHECK (("reversed_at" IS NULL) = ("reverse_reason" IS NULL));
  END IF;
END
$$;

-- The manual queue, in the order it is worked.
CREATE INDEX IF NOT EXISTS "merge_candidate_pending_idx"
  ON "merge_candidate" ("band", "score" DESC, "id") WHERE "state" = 'pending';

-- A record has one open question at a time: its best match.
CREATE UNIQUE INDEX IF NOT EXISTS "merge_candidate_open_record"
  ON "merge_candidate" ("staged_listing_id") WHERE "state" = 'pending' AND "staged_listing_id" IS NOT NULL;

-- B5: a rollback finds every pair its run produced.
CREATE INDEX IF NOT EXISTS "merge_candidate_source_run_idx"
  ON "merge_candidate" ("source_run_id") WHERE "source_run_id" IS NOT NULL;

-- B6: the today rail reads resolutions by person and day.
CREATE INDEX IF NOT EXISTS "merge_candidate_resolved_idx"
  ON "merge_candidate" ("resolved_by_id", "resolved_at") WHERE "resolved_at" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The merge
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "business_merge"
  ADD COLUMN IF NOT EXISTS "batch_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "source_run_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_merge_batch_id_fkey') THEN
    ALTER TABLE "business_merge"
      ADD CONSTRAINT "business_merge_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "merge_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_merge_source_run_id_fkey') THEN
    ALTER TABLE "business_merge"
      ADD CONSTRAINT "business_merge_source_run_id_fkey"
      FOREIGN KEY ("source_run_id") REFERENCES "licence_import_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- The runs a merge consumed a record from, for the rollback that follows them.
UPDATE "business_merge" AS m
   SET "source_run_id" = b."licence_import_run_id"
  FROM "business" AS b
 WHERE b."id" = m."absorb_id" AND m."source_run_id" IS NULL AND b."licence_import_run_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "business_merge_source_run_idx"
  ON "business_merge" ("source_run_id") WHERE "source_run_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. A branch keeps its own registry identity — B9
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "location"
  ADD COLUMN IF NOT EXISTS "licence_number"         TEXT,
  ADD COLUMN IF NOT EXISTS "added_by_candidate_id"  TEXT;

DO $$
BEGIN
  -- SET NULL: a pair deleted with its run leaves the branch it produced alone;
  -- by then the branch is the owner's.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_added_by_candidate_id_fkey') THEN
    ALTER TABLE "location"
      ADD CONSTRAINT "location_added_by_candidate_id_fkey"
      FOREIGN KEY ("added_by_candidate_id") REFERENCES "merge_candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "location_added_by_candidate_idx"
  ON "location" ("added_by_candidate_id") WHERE "added_by_candidate_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. The staged record, after a pair resolves
-- ─────────────────────────────────────────────────────────────────────────────

-- A merged record points at the listing it became a branch of, the way a
-- published record points at the listing it became.
ALTER TABLE "staged_listing" DROP CONSTRAINT IF EXISTS "staged_listing_published_has_a_business";
ALTER TABLE "staged_listing"
  ADD CONSTRAINT "staged_listing_published_has_a_business"
  CHECK (
    ("disposition"::text IN ('published', 'merged') AND "business_id" IS NOT NULL)
    OR
    ("disposition"::text NOT IN ('published', 'merged') AND "business_id" IS NULL)
  );

-- A resolved duplicate keeps the name of what it duplicated: the record of the
-- decision is worth more than a tidy column.
ALTER TABLE "staged_listing" DROP CONSTRAINT IF EXISTS "staged_listing_duplicate_names_its_original";
ALTER TABLE "staged_listing"
  ADD CONSTRAINT "staged_listing_duplicate_names_its_original"
  CHECK (
    ("duplicate_of_id" IS NULL AND "duplicate_of_row" IS NULL)
    OR "disposition"::text IN ('duplicate', 'merged', 'discarded')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Under the floor — B10, Q1
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "licence_import_run"
  ADD COLUMN IF NOT EXISTS "below_floor_count" INTEGER NOT NULL DEFAULT 0;
