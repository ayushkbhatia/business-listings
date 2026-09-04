-- Board 1i: a requirement is revised, never silently edited.

-- AlterTable
ALTER TABLE "enquiry" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "enquiry" ADD COLUMN     "revised_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "quote" ADD COLUMN     "superseded_at" TIMESTAMP(3);
ALTER TABLE "quote" ADD COLUMN     "against_revision" INTEGER NOT NULL DEFAULT 1;

-- A revision is a number and a date together, or neither.
--
-- The page renders "REVISED 2 SEP · R2" from both. A row carrying one without
-- the other renders either a dateless claim that something changed or a date
-- with no revision to attach it to, and a buyer deciding whether their seller
-- priced the current requirement cannot act on either.
--
-- R1 is the unrevised case and carries no date, which is every enquiry that was
-- sent once and left alone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enquiry_revision_dated'
  ) THEN
    ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_revision_dated" CHECK (
      ("revision" = 1 AND "revised_at" IS NULL)
      OR ("revision" > 1 AND "revised_at" IS NOT NULL)
    );
  END IF;

  -- A quote cannot have been priced against a revision that does not exist yet.
  -- Cross-table, so this is the half that can be checked in one row: the
  -- revision a quote names is at least the first one.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quote_against_revision_sane'
  ) THEN
    ALTER TABLE "quote" ADD CONSTRAINT "quote_against_revision_sane" CHECK (
      "against_revision" >= 1
    );
  END IF;
END $$;

-- The buyer's tracking page reads recipients and their quotes together, and the
-- superseded flag decides how a quoted row renders. Partial, because almost no
-- quote is ever superseded.
CREATE INDEX IF NOT EXISTS "quote_superseded_at_idx"
  ON "quote" ("enquiry_id", "superseded_at")
  WHERE "superseded_at" IS NOT NULL;
