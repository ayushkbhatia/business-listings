-- Board 12a, board-level pass. The licence importer's missing half.
--
-- `20260826140000_licence_ingest` built staging and one decision: approve. A
-- row staged `needs_category` had no writer that could ever give it one, a run
-- could not be discarded, and nothing could be taken back. This adds the rest
-- of a run's life and the two records a categorisation queue needs.
--
-- Additive throughout. Nothing is dropped except one CHECK, which is replaced
-- in the same statement group by a wider one that every existing row and every
-- write the previous deployment makes still satisfies — so this applies before
-- the merge, per docs/deployments.md § Ordering.
--
-- The new enum values are compared as `::text` inside the CHECKs below. A value
-- added by `ALTER TYPE … ADD VALUE` cannot be used as that type in the same
-- transaction, and a text comparison is not a use of it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Two states
-- ─────────────────────────────────────────────────────────────────────────────

-- B4: every run is reversible for thirty days. Terminal once taken.
ALTER TYPE "ingest_run_status" ADD VALUE IF NOT EXISTS 'rolled_back';

-- B9: a record naming a licence the directory already holds is 12b's, and is
-- never published from the importer. Before `published`, so the enum reads in
-- the order a record moves through it.
ALTER TYPE "staged_disposition" ADD VALUE IF NOT EXISTS 'duplicate' BEFORE 'published';

-- B7: where a category came from. Created here, so its values are usable here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staged_category_source') THEN
    CREATE TYPE "staged_category_source" AS ENUM ('signal', 'mapping', 'staff');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The run
-- ─────────────────────────────────────────────────────────────────────────────

-- "Run 14". SERIAL numbers existing rows in scan order, which is arbitrary, so
-- they are renumbered by (created_at, id) straight after — `created_at` alone
-- is not a total order.
ALTER TABLE "licence_import_run" ADD COLUMN IF NOT EXISTS "number" SERIAL NOT NULL;

UPDATE "licence_import_run" AS r
   SET "number" = ordered.n
  FROM (
    SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n
      FROM "licence_import_run"
  ) AS ordered
 WHERE ordered."id" = r."id";

SELECT setval(
  pg_get_serial_sequence('"licence_import_run"', 'number'),
  GREATEST((SELECT COALESCE(MAX("number"), 0) FROM "licence_import_run"), 1),
  (SELECT COUNT(*) > 0 FROM "licence_import_run")
);

CREATE UNIQUE INDEX IF NOT EXISTS "licence_import_run_number_key"
  ON "licence_import_run" ("number");

ALTER TABLE "licence_import_run"
  ADD COLUMN IF NOT EXISTS "truncated_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "duplicate_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "decided_by_id"     UUID,
  ADD COLUMN IF NOT EXISTS "reversible_until"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rolled_back_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rolled_back_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "rollback_reason"   TEXT,
  ADD COLUMN IF NOT EXISTS "rollback_manifest" JSONB,
  -- The file's header row, in its order. `staged_listing.raw` is JSONB, which
  -- keeps every value and not the column order, so "the raw row, verbatim"
  -- (B5) needs the order written down once per file.
  ADD COLUMN IF NOT EXISTS "headers"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licence_import_run_decided_by_id_fkey') THEN
    ALTER TABLE "licence_import_run"
      ADD CONSTRAINT "licence_import_run_decided_by_id_fkey"
      FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licence_import_run_rolled_back_by_id_fkey') THEN
    ALTER TABLE "licence_import_run"
      ADD CONSTRAINT "licence_import_run_rolled_back_by_id_fkey"
      FOREIGN KEY ("rolled_back_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- Who decided the runs already decided. The approval has always written an
-- audit row naming its actor, so the answer is on record; the run screen was
-- printing the uploader's name instead.
UPDATE "licence_import_run" AS r
   SET "decided_by_id" = a."actor_id"
  FROM "audit_event" AS a
 WHERE a."subject" = 'LicenceImportRun:' || r."id"
   AND a."action" = 'queue_decided'
   AND r."decided_by_id" IS NULL;

-- The thirty days, for runs approved before the window existed. Counted from
-- the decision, which is when their listings were created.
UPDATE "licence_import_run"
   SET "reversible_until" = "decided_at" + INTERVAL '30 days'
 WHERE "status"::text = 'approved'
   AND "reversible_until" IS NULL
   AND "decided_at" IS NOT NULL;

-- Widened to the new terminal state. A rolled-back run was approved first, so
-- it keeps the approval's reason beside the rollback's own.
ALTER TABLE "licence_import_run" DROP CONSTRAINT IF EXISTS "licence_import_run_decision_has_a_reason";
ALTER TABLE "licence_import_run"
  ADD CONSTRAINT "licence_import_run_decision_has_a_reason"
  CHECK (
    ("status"::text IN ('parsing', 'staged') AND "decided_at" IS NULL AND "decision_reason" IS NULL)
    OR
    ("status"::text IN ('approved', 'discarded', 'rolled_back')
      AND "decided_at" IS NOT NULL AND "decision_reason" IS NOT NULL)
  );

-- A rollback is whole or absent: its time, its actor, a written reason and the
-- manifest of what it took down and what it left.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licence_import_run_rollback_is_whole') THEN
    ALTER TABLE "licence_import_run"
      ADD CONSTRAINT "licence_import_run_rollback_is_whole"
      CHECK (
        ("status"::text = 'rolled_back')
        =
        ("rolled_back_at" IS NOT NULL AND "rolled_back_by_id" IS NOT NULL
          AND "rollback_manifest" IS NOT NULL
          AND "rollback_reason" IS NOT NULL AND btrim("rollback_reason") <> '')
      );
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The staged record
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "staged_listing"
  ADD COLUMN IF NOT EXISTS "activity_key"      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "category_source"   "staged_category_source",
  ADD COLUMN IF NOT EXISTS "categorised_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "categorised_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "duplicate_of_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "duplicate_of_row"  INTEGER;

-- The same normalisation as `activityKey` in lib/ingest/classify.ts: ASCII
-- whitespace collapsed to one space, trimmed, lower-cased.
UPDATE "staged_listing"
   SET "activity_key" = lower(btrim(regexp_replace(COALESCE("activity", ''), '[ \t\n\r\f\v]+', ' ', 'g')))
 WHERE "activity_key" = '' AND "activity" IS NOT NULL;

-- Every category a record already holds came from the keyword signals: nothing
-- else could write one.
UPDATE "staged_listing"
   SET "category_source" = 'signal'
 WHERE "category_id" IS NOT NULL AND "category_source" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staged_listing_categorised_by_id_fkey') THEN
    ALTER TABLE "staged_listing"
      ADD CONSTRAINT "staged_listing_categorised_by_id_fkey"
      FOREIGN KEY ("categorised_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- SET NULL: the listing a record duplicated going away does not make the
  -- record a new company.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staged_listing_duplicate_of_id_fkey') THEN
    ALTER TABLE "staged_listing"
      ADD CONSTRAINT "staged_listing_duplicate_of_id_fkey"
      FOREIGN KEY ("duplicate_of_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- Only a duplicate says what it duplicates. One direction only, so the SET
  -- NULL above cannot be refused by it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staged_listing_duplicate_names_its_original') THEN
    ALTER TABLE "staged_listing"
      ADD CONSTRAINT "staged_listing_duplicate_names_its_original"
      CHECK (
        ("duplicate_of_id" IS NULL AND "duplicate_of_row" IS NULL)
        OR "disposition"::text = 'duplicate'
      );
  END IF;
  -- A category a person chose says who and when. The queue's audit row is the
  -- record; this is what the record screen reads back.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staged_listing_staff_category_names_its_author') THEN
    ALTER TABLE "staged_listing"
      ADD CONSTRAINT "staged_listing_staff_category_names_its_author"
      CHECK (
        ("category_source" IS DISTINCT FROM 'staff' AND "categorised_by_id" IS NULL AND "categorised_at" IS NULL)
        OR
        ("category_source" = 'staff' AND "categorised_by_id" IS NOT NULL AND "categorised_at" IS NOT NULL)
      );
  END IF;
  -- A source without a category is a claim about nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staged_listing_category_source_has_a_category') THEN
    ALTER TABLE "staged_listing"
      ADD CONSTRAINT "staged_listing_category_source_has_a_category"
      CHECK ("category_source" IS NULL OR "category_id" IS NOT NULL);
  END IF;
END
$$;

-- The categorisation queue: grouped by phrase, across every open run.
CREATE INDEX IF NOT EXISTS "staged_listing_queue_idx"
  ON "staged_listing" ("activity_key") WHERE "disposition" = 'needs_category';

CREATE INDEX IF NOT EXISTS "staged_listing_duplicate_of_id_idx"
  ON "staged_listing" ("duplicate_of_id") WHERE "duplicate_of_id" IS NOT NULL;

-- Duplicate detection at staging reads existing licences by authority.
CREATE INDEX IF NOT EXISTS "business_licence_authority_number_idx"
  ON "business" ("licence_authority", "licence_number");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A decision, remembered
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "licence_activity_mapping" (
  "id"           TEXT NOT NULL,
  "activity_key" TEXT NOT NULL,
  "activity"     TEXT NOT NULL,
  "category_id"  TEXT NOT NULL,
  "actor_id"     UUID NOT NULL,
  "reason"       TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "licence_activity_mapping_pkey" PRIMARY KEY ("id"),
  -- An empty phrase is a record with no activity, and there is no decision
  -- about "nothing" worth applying to the next file.
  CONSTRAINT "licence_activity_mapping_key_not_blank" CHECK (btrim("activity_key") <> ''),
  CONSTRAINT "licence_activity_mapping_reason_not_blank" CHECK (btrim("reason") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "licence_activity_mapping_activity_key_key"
  ON "licence_activity_mapping" ("activity_key");

CREATE INDEX IF NOT EXISTS "licence_activity_mapping_category_id_idx"
  ON "licence_activity_mapping" ("category_id");

DO $$
BEGIN
  -- CASCADE: a remembered decision about a category that no longer exists is
  -- a decision about nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licence_activity_mapping_category_id_fkey') THEN
    ALTER TABLE "licence_activity_mapping"
      ADD CONSTRAINT "licence_activity_mapping_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licence_activity_mapping_actor_id_fkey') THEN
    ALTER TABLE "licence_activity_mapping"
      ADD CONSTRAINT "licence_activity_mapping_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
