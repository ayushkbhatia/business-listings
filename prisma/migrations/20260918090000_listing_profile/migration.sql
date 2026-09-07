-- Board 3b — the listing profile editor.
--
-- Three additions, no drops, nothing rewritten. Each one exists because the
-- screen states something the model could not hold.
--
--   1. `additional_category` on `moderated_field`. The enum's own comment says
--      adding a value is a product decision; board 3b Q1 takes it. Category
--      membership is the join the enquiry fan-out matches on, so adding one
--      moves which demand a listing receives — the same reason the primary
--      category has queued since handoff 1.
--
--   2. `library` on `media_kind`. Every other value names a surface, which made
--      "in the library and on nothing" unrepresentable: `referencesFor` counts
--      any non-product file as a storefront reference, so a photograph the
--      seller removed from their listing had nowhere to go that did not either
--      keep it on the page or claim it belonged to a product. Criterion 7 —
--      unpicking is not deleting — needs a destination.
--
--   3. `listing_revision`. The rail shows three recent changes with an author.
--      Nothing recorded a seller's own edits: `audit_event` is the staff
--      decision log, its `actor_id` is a staff member, and filing "S. Menon
--      edited their description" there would dilute the one table whose value is
--      that every row is a staff action somebody can be asked about.
--
-- Every statement is idempotent. `migrate dev` regenerates hand-written DDL and
-- drops what it did not author otherwise.

-- ── 1 · the fourth moderated field ─────────────────────────────────────────
-- ADD VALUE IF NOT EXISTS is not transactional on older servers; guarded so a
-- re-run is a no-op rather than an error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'moderated_field' AND e.enumlabel = 'additional_category'
  ) THEN
    ALTER TYPE "moderated_field" ADD VALUE 'additional_category';
  END IF;
END
$$;

-- ── 2 · a media kind that names no surface ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'media_kind' AND e.enumlabel = 'library'
  ) THEN
    ALTER TYPE "media_kind" ADD VALUE 'library';
  END IF;
END
$$;

-- ── 3 · the seller's own recent changes ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "listing_revision" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "actor_id"    UUID NOT NULL,
  "field"       TEXT NOT NULL,
  "item_count"  INTEGER,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listing_revision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "listing_revision_business_id_created_at_idx"
  ON "listing_revision" ("business_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listing_revision_business_id_fkey'
  ) THEN
    ALTER TABLE "listing_revision"
      ADD CONSTRAINT "listing_revision_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listing_revision_actor_id_fkey'
  ) THEN
    ALTER TABLE "listing_revision"
      ADD CONSTRAINT "listing_revision_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "user"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
