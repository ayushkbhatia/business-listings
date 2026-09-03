-- Board 1f: a branch that is shut for a stated stretch, and still worth showing.

-- AlterTable
ALTER TABLE "location" ADD COLUMN     "closed_from" TIMESTAMP(3);
ALTER TABLE "location" ADD COLUMN     "closed_until" TIMESTAMP(3);
ALTER TABLE "location" ADD COLUMN     "closure_reason" TEXT;

-- A closure is all three columns or none of them.
--
-- The strip on the branch card states the dates and the reason, and it can only
-- do that if a closure carries both. A half-set window renders as a warn strip
-- with a blank in it, which reads as a bug to a buyer and tells them nothing —
-- worse than the branch simply showing its hours.
--
-- The end date must not precede the start, because a window that closes before
-- it opens is never active and would sit in the table looking like a closure
-- that silently does nothing.
--
-- Written idempotently: `migrate dev` regenerates this table from the schema
-- when it diffs, and a constraint it does not know about would be dropped on the
-- way through.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_closure_complete'
  ) THEN
    ALTER TABLE "location" ADD CONSTRAINT "location_closure_complete" CHECK (
      (
        "closed_from" IS NULL
        AND "closed_until" IS NULL
        AND "closure_reason" IS NULL
      )
      OR (
        "closed_from" IS NOT NULL
        AND "closed_until" IS NOT NULL
        AND "closure_reason" IS NOT NULL
        AND length(btrim("closure_reason")) > 0
        AND "closed_until" >= "closed_from"
      )
    );
  END IF;
END $$;

-- Only the active and upcoming windows are ever read, and always for one
-- business at a time. Partial, so the index does not carry the overwhelming
-- majority of rows that have no closure at all.
CREATE INDEX IF NOT EXISTS "location_closed_until_idx"
  ON "location" ("closed_until")
  WHERE "closed_until" IS NOT NULL;
