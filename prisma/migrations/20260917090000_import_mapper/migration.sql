-- Board 11d · the CSV import mapper
--
-- Additive throughout: nothing is dropped and nothing is rewritten in place, so
-- this applies **before** the merge, per docs/deployments.md § Ordering. The
-- running deployment reads none of these columns and is unaffected by all three.
--
-- ── 1 · media.filename ──────────────────────────────────────────────────────
--
-- 11d matches a CSV column of filenames against the media library. `Document`
-- has carried `filename` since handoff 1; `Media` never has, so the two halves
-- of one library answered "what is this file called?" two different ways.
--
-- It cannot be derived. `safeName` (lib/storage/buckets.ts) lowercases, replaces
-- punctuation and appends six random characters, so `BF-100 (1).JPG` is stored
-- as `bf-100-1-x7k2m9.jpg`. A mapper matching on the stored path would resolve
-- nothing at all and report that as "no filenames matched", which is a true
-- sentence about the wrong question.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "filename" TEXT;

-- The best name available for a file uploaded before this column existed: the
-- stored basename, random suffix and all. `lib/import/filenames.ts` strips that
-- suffix when it compares, so these rows still match what the seller typed.
-- Left NULL where the path has no basename to take, rather than writing ''.
UPDATE "media"
SET "filename" = regexp_replace("storage_path", '^.*/', '')
WHERE "filename" IS NULL
  AND "storage_path" IS NOT NULL
  AND regexp_replace("storage_path", '^.*/', '') <> '';

-- ── 2 · What a run did, in three numbers that sum ───────────────────────────
--
-- §4 asserts `new + updated + errors == rows`. `created_count` was the only one
-- stored, so the other two could only ever be rendered from constants — which
-- is what the board did.
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "updated_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "error_count"   INTEGER NOT NULL DEFAULT 0;
-- Listed is not created. On Free, 412 rows import and ten list; the gap between
-- these two columns is the whole of the cap outcome.
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "listed_count"  INTEGER NOT NULL DEFAULT 0;

-- Existing runs created products and updated none — that path could not update.
-- So the historical values are correct as defaulted, and `listed_count` is
-- honestly 0: every import before this board landed its products as drafts.

-- ── 3 · What a run overwrote ────────────────────────────────────────────────
--
-- Rollback restores updated products to their previous values. `import_run_id`
-- on the product names what a run created; nothing named what it changed, and a
-- previous value cannot be recovered after the write that replaced it.
CREATE TABLE IF NOT EXISTS "import_run_change" (
  "id"             TEXT NOT NULL,
  "import_run_id"  TEXT NOT NULL,
  "product_id"     TEXT NOT NULL,
  "previous"       JSONB NOT NULL,
  -- Ordered: board 3i settled that position 0 **is** the primary image and
  -- there is no separate flag, so restoring the set without the order restores
  -- a different primary image.
  "previous_media" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_run_change_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_run_change_import_run_id_fkey') THEN
    ALTER TABLE "import_run_change" ADD CONSTRAINT "import_run_change_import_run_id_fkey"
      FOREIGN KEY ("import_run_id") REFERENCES "import_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_run_change_product_id_fkey') THEN
    ALTER TABLE "import_run_change" ADD CONSTRAINT "import_run_change_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- One snapshot per product per run. A run that touches the same product twice
-- keeps the state before the run, not before the second write.
CREATE UNIQUE INDEX IF NOT EXISTS "import_run_change_import_run_id_product_id_key"
  ON "import_run_change" ("import_run_id", "product_id");
CREATE INDEX IF NOT EXISTS "import_run_change_product_id_idx"
  ON "import_run_change" ("product_id");
