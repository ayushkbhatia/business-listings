-- Board 10b — the guide index.
--
-- Additive throughout: one table, four nullable-or-defaulted columns on
-- `guide`, and two indexes. Nothing is dropped and no existing row changes
-- meaning, so it applies cleanly before the merge in the ordering
-- `docs/deployments.md` describes.

-- ---------------------------------------------------------------------------
-- The shelves a reader browses by.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "guide_subject" (
  "id"         TEXT NOT NULL,
  "slug"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "blurb"      TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guide_subject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guide_subject_slug_key" ON "guide_subject" ("slug");

-- A slug is a URL segment. The service refuses anything else before it writes,
-- and this refuses it again for any path that ever forgets to ask.
DO $$
BEGIN
  ALTER TABLE "guide_subject" ADD CONSTRAINT "guide_subject_slug_shape"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- The columns the index reads.
-- ---------------------------------------------------------------------------

ALTER TABLE "guide"
  ADD COLUMN IF NOT EXISTS "subject_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "sort_order"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "featured_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "featured_note" TEXT;

-- The note belongs to the slot, so it cannot outlive it: a sentence explaining
-- why an article is first, still on the page after the slot moved to a
-- different article, is exactly the frozen-claim failure board 6b's snapshot
-- model and this board's own §Ordering both exist to prevent.
DO $$
BEGIN
  ALTER TABLE "guide" ADD CONSTRAINT "guide_featured_note_needs_slot"
    CHECK ("featured_note" IS NULL OR "featured_at" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "guide" ADD CONSTRAINT "guide_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "guide_subject"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "guide_subject_id_sort_order_idx"
  ON "guide" ("subject_id", "sort_order");

-- One featured guide, enforced by Postgres rather than by an `if`.
--
-- A unique index over a constant expression, filtered to the featured rows: the
-- expression is identical for every row, so at most one row can satisfy the
-- predicate. Board 10b §4 says the slot is editorial and holds one article, and
-- a second one appearing is the kind of thing nobody notices until the page has
-- two heroes.
CREATE UNIQUE INDEX IF NOT EXISTS "guide_one_featured"
  ON "guide" ((TRUE)) WHERE "featured_at" IS NOT NULL;
