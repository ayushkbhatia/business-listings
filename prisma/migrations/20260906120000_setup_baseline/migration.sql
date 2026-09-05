-- Board 8e: the snapshot the completion screen reads, and the marker that makes
-- it once-only.
--
-- Idempotent throughout, like every hand-written migration here.
--
-- ## Why a table rather than columns on `business`
--
-- Every column below is about one episode — the seller's first run — and none of
-- them is a fact about the listing. A listing that never sees the hub has no row
-- rather than five nulls, and `business` does not grow five columns that mean
-- nothing for the 41,000 imported listings that will never claim.
--
-- One row per business, ever. The unique is what makes "first seen" true: the
-- write is an upsert that inserts and never updates, so a second hub render
-- cannot move the baseline the screen is about to compare against.
CREATE TABLE IF NOT EXISTS "setup_baseline" (
  "business_id"     TEXT PRIMARY KEY,

  -- When the hub was first rendered for this listing. The denominator of board
  -- 8e §7's one number worth watching: hours from first hub view to completion.
  "first_seen_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- `profile_strength` at that moment. The completion screen's "up from 62%".
  -- Nullable because a listing can reach the hub before the strength job has
  -- ever run, and a baseline of 0 would be a claim rather than an absence —
  -- §2 says drop the clause rather than guess a baseline.
  "baseline_score"  INTEGER,

  -- Distinct filterable (field, value) pairs the published catalogue carried at
  -- that moment. The other half of "14 spec filters you were invisible to this
  -- morning" — without a before there is no delta, only a total, and §6 is
  -- explicit that a total must not stand in for one.
  "baseline_facets" INTEGER,

  -- When all three tasks first closed. Written by the hub on the transition,
  -- not by a job, because the hub is the only thing that knows the moment.
  "completed_at"    TIMESTAMP(3),

  -- When /dashboard/setup/done was actually rendered. This is the once-only
  -- rule: §1 says the seller reaches that screen exactly once, on the
  -- transition, and a completion screen that can be revisited is a stale
  -- dashboard. Null means the screen is still owed.
  "done_seen_at"    TIMESTAMP(3)
);

DO $$
BEGIN
    ALTER TABLE "setup_baseline" ADD CONSTRAINT "setup_baseline_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The completion funnel's read: rows that finished, oldest first.
CREATE INDEX IF NOT EXISTS "setup_baseline_completed_idx"
  ON "setup_baseline"("completed_at");
