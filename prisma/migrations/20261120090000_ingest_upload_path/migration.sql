-- Task T4.1 — the licence export arrives through object storage, and the run
-- records where it still sits.
--
-- Purely **additive**: one nullable column, no constraint, no data. By
-- `docs/deployments.md` § Ordering that means it applies *before* the merge
-- that reads it, and nothing on `main` reads it until then.
--
-- Nullable rather than defaulted, and it stays nullable forever: a run staged
-- from text has no object behind it, which is true of every run before this
-- migration, of the seed, and of every integration test. `NOT NULL DEFAULT ''`
-- would make "no file" and "a file at the empty path" the same value.
ALTER TABLE "licence_import_run"
  ADD COLUMN IF NOT EXISTS "upload_path" TEXT;
