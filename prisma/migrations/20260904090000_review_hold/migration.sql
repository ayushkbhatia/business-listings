-- Board 1m: a review held pending a moderation decision.
--
-- Removal was the only moderation state a review had, and removal is final.
-- The reviews page has to render a third thing — "one review is being reviewed
-- by our team", with no content, no rating, and excluded from every average
-- while the hold stands. Reusing `removed_at` for that would make a reversible
-- pause indistinguishable from a permanent decision in the audit log.

ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "held_at" TIMESTAMP(3);
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "held_reason" TEXT;

-- The public read: one business, published, newest first.
--
-- Every figure on the reviews page — the average, the distribution, the four
-- dimension averages, the provenance counts and the page itself — filters on
-- `removed_at IS NULL AND held_at IS NULL`, so the hold column belongs in the
-- key rather than being a filter applied after the index has done its work.
CREATE INDEX IF NOT EXISTS "review_business_id_removed_at_held_at_created_at_idx"
  ON "review"("business_id", "removed_at", "held_at", "created_at");

-- And the one it replaces, which it has as a prefix.
--
-- Postgres would never choose `(business_id, removed_at)` over an index that
-- starts with the same two columns, so keeping it costs a write on every review
-- and buys nothing. Dropped here rather than left for `migrate dev` to notice,
-- because a hand-written index the schema does not declare is drift and the
-- next `migrate dev` writes a migration to drop it — which is how four indexes
-- were lost once already. See docs/database.md.
DROP INDEX IF EXISTS "review_business_id_removed_at_idx";

-- A hold carries its reason, exactly as a removal does.
--
-- Non-negotiable 3: every staff state change writes an audit row with a written
-- reason. The audit row is written by the service layer; this constraint is
-- what makes the column unable to disagree with it, and it is the same pairing
-- `review_removal_reason_required` already enforces one column along.
--
-- Idempotent, because `migrate dev` regenerates the table when it diffs the
-- schema and would otherwise drop a constraint it does not know about.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_hold_reason_required'
  ) THEN
    ALTER TABLE "review" ADD CONSTRAINT "review_hold_reason_required" CHECK (
      ("held_at" IS NULL AND "held_reason" IS NULL)
      OR (
        "held_at" IS NOT NULL
        AND "held_reason" IS NOT NULL
        AND length(btrim("held_reason")) > 0
      )
    );
  END IF;
END $$;
