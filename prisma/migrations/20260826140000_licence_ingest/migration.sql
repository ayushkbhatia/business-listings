-- Handoff 4, step 2a. The licence-record importer.
--
-- Deliberately not `import_run`. That table is handoff 3's seller CSV *product*
-- importer: `business_id` is NOT NULL with a cascading FK, its only child is
-- `product`, and its revert path reads business + created_at. A licence run has
-- no owning business and produces listings. Reusing it would mean making
-- `business_id` nullable and would break the seller's 24-hour revert.

CREATE TYPE "ingest_run_status" AS ENUM ('parsing', 'staged', 'approved', 'discarded');

CREATE TABLE "licence_import_run" (
  "id"          TEXT NOT NULL,
  "actor_id"    UUID NOT NULL,
  -- Which authority's export this is. Free text: a new authority is a Tuesday,
  -- not a migration.
  "source"      TEXT NOT NULL,
  "filename"    TEXT NOT NULL,
  "status"      "ingest_run_status" NOT NULL DEFAULT 'parsing',
  "row_count"   INTEGER NOT NULL DEFAULT 0,
  -- Counted at stage time so the screen does not recount 8,000 rows to render.
  "staged_count"     INTEGER NOT NULL DEFAULT 0,
  "categorised_count" INTEGER NOT NULL DEFAULT 0,
  "queued_count"     INTEGER NOT NULL DEFAULT 0,
  "rejected_count"   INTEGER NOT NULL DEFAULT 0,
  -- NOT NULL once approved or discarded, paired by the CHECK below.
  "decision_reason" TEXT,
  "decided_at"  TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "licence_import_run_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "licence_import_run"
  ADD CONSTRAINT "licence_import_run_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "licence_import_run"
  ADD CONSTRAINT "licence_import_run_decision_has_a_reason"
  CHECK (
    ("status" IN ('parsing', 'staged') AND "decided_at" IS NULL AND "decision_reason" IS NULL)
    OR
    ("status" IN ('approved', 'discarded') AND "decided_at" IS NOT NULL AND "decision_reason" IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS "licence_import_run_status_created_at_idx"
  ON "licence_import_run" ("status", "created_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- The staged row
--
-- A licence record cannot be staged into `business`: slug is unique and NOT
-- NULL, primary_category_id is NOT NULL with a RESTRICT FK, and licence_expiry
-- and licence_authority are NOT NULL. A record whose category could not be
-- inferred has nowhere legal to sit there — which is the whole reason staging
-- needs its own table rather than an unpublished business.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "staged_disposition" AS ENUM (
  -- Parsed, categorised, ready to become a listing.
  'ready',
  -- Parsed, but the category could not be inferred. A person picks one.
  'needs_category',
  -- Refused, for one of the four grounds below.
  'rejected',
  -- Became a Business when the run was approved.
  'published'
);

-- The README fixes four. An enum rather than a string because these are counted
-- and the counts are the screen — the same argument `skip_reason` makes.
CREATE TYPE "rejection_ground" AS ENUM (
  'licence_expired_24_months',
  'no_readable_trade_name',
  'activity_out_of_scope',
  'address_outside_uae'
);

CREATE TABLE "staged_listing" (
  "id"          TEXT NOT NULL,
  "run_id"      TEXT NOT NULL,
  "row_number"  INTEGER NOT NULL,
  -- Everything as it arrived, before we decided anything about it. Kept so a
  -- rejection can be argued with.
  "raw"         JSONB NOT NULL,
  "trade_name"  TEXT,
  "licence_number" TEXT,
  "licence_authority" TEXT,
  "licence_expiry" TIMESTAMP(3),
  "emirate"     TEXT,
  "area_name"   TEXT,
  "activity"    TEXT,
  "phone"       TEXT,
  -- Nullable, unlike on `business`. That is the point of staging.
  "category_id" TEXT,
  "disposition" "staged_disposition" NOT NULL DEFAULT 'needs_category',
  "rejection_ground" "rejection_ground",
  -- Set when the run is approved and this row becomes a listing.
  "business_id" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "staged_listing_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "staged_listing"
  ADD CONSTRAINT "staged_listing_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "licence_import_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "staged_listing"
  ADD CONSTRAINT "staged_listing_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SET NULL rather than CASCADE: deleting a listing somebody merged away should
-- not delete the record of where it came from.
ALTER TABLE "staged_listing"
  ADD CONSTRAINT "staged_listing_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A rejection carries its ground, and nothing else does. "Rejections by
-- countable reason" is criterion 1, and an uncounted rejection is the failure.
ALTER TABLE "staged_listing"
  ADD CONSTRAINT "staged_listing_rejection_has_a_ground"
  CHECK (
    ("disposition" = 'rejected' AND "rejection_ground" IS NOT NULL)
    OR
    ("disposition" <> 'rejected' AND "rejection_ground" IS NULL)
  );

-- Nothing publishes itself. A row is only linked to a business once somebody
-- approved the run, and only a `published` row may carry one.
ALTER TABLE "staged_listing"
  ADD CONSTRAINT "staged_listing_published_has_a_business"
  CHECK (
    ("disposition" = 'published' AND "business_id" IS NOT NULL)
    OR
    ("disposition" <> 'published' AND "business_id" IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "staged_listing_run_row_key"
  ON "staged_listing" ("run_id", "row_number");

CREATE INDEX IF NOT EXISTS "staged_listing_run_disposition_idx"
  ON "staged_listing" ("run_id", "disposition");

-- The dedupe pass in step 2b matches on these.
CREATE INDEX IF NOT EXISTS "staged_listing_licence_number_idx"
  ON "staged_listing" ("licence_number") WHERE "licence_number" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Provenance
--
-- `business.import_run_id` has been a bare TEXT column since the init migration
-- with no foreign key, no relation, no index and no reader or writer anywhere.
-- It predates `import_run`, which points at products. This gives it the meaning
-- its name has been claiming.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "business"
  ADD COLUMN "licence_import_run_id" TEXT;

ALTER TABLE "business"
  ADD CONSTRAINT "business_licence_import_run_id_fkey"
  FOREIGN KEY ("licence_import_run_id") REFERENCES "licence_import_run"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "business_licence_import_run_id_idx"
  ON "business" ("licence_import_run_id") WHERE "licence_import_run_id" IS NOT NULL;

-- The bare column goes. Nothing reads it, nothing writes it, and leaving two
-- columns whose names both promise import provenance is how the next person
-- picks the wrong one.
ALTER TABLE "business" DROP COLUMN "import_run_id";
