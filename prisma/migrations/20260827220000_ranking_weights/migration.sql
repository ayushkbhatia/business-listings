-- Handoff 4, board 12c. Ranking weights and manual boosts.
--
-- Criterion 5: "weights reorder live results; a boost needs reason and expiry."
--
-- `lib/search/ranking.ts` has carried `DEFAULT_WEIGHTS` since handoff 1, with a
-- comment saying the admin editor in handoff 4 would have "one thing to write
-- to". `searchBusinesses` has always taken a `weights` option and no caller
-- ever passed one, so the constant was the whole configuration and nothing
-- staff could do reordered anything.

CREATE TABLE "ranking_weights" (
  "id"                TEXT NOT NULL DEFAULT 'current',
  "relevance"         INTEGER NOT NULL,
  "verification_tier" INTEGER NOT NULL,
  "response_time"     INTEGER NOT NULL,
  "spec_completeness" INTEGER NOT NULL,
  "distance"          INTEGER NOT NULL,
  "plan_tier"         INTEGER NOT NULL,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ranking_weights_pkey" PRIMARY KEY ("id")
);

-- Every weight is a non-negative number, and they are not all zero — a set that
-- sums to nothing ranks everything equally and turns the results into whatever
-- order Postgres felt like.
ALTER TABLE "ranking_weights"
  ADD CONSTRAINT "ranking_weights_are_not_negative"
  CHECK (
    "relevance" >= 0 AND "verification_tier" >= 0 AND "response_time" >= 0
    AND "spec_completeness" >= 0 AND "distance" >= 0 AND "plan_tier" >= 0
    AND ("relevance" + "verification_tier" + "response_time"
         + "spec_completeness" + "distance" + "plan_tier") > 0
  );

-- Plan tier is capped in the schema, not only in a review.
--
-- Above about ten the results stop being useful and buyers notice inside a
-- week. The subscription only holds if being found is worth paying for, so the
-- one weight that money buys is the one the database refuses to let run away.
ALTER TABLE "ranking_weights"
  ADD CONSTRAINT "ranking_weights_plan_tier_is_capped"
  CHECK ("plan_tier" <= 10);

-- The row is a singleton. One ranking, not one per whoever wrote last.
ALTER TABLE "ranking_weights"
  ADD CONSTRAINT "ranking_weights_is_a_singleton"
  CHECK ("id" = 'current');

INSERT INTO "ranking_weights"
  ("id", "relevance", "verification_tier", "response_time", "spec_completeness", "distance", "plan_tier", "updated_at")
VALUES
  ('current', 34, 22, 18, 12, 8, 6, CURRENT_TIMESTAMP);

-- ── Manual boosts ───────────────────────────────────────────────────────────
--
-- Criterion 5's second half. Both columns are NOT NULL, so a boost that
-- outlives the reason for it cannot exist — which is the failure mode a manual
-- override has: somebody helps a supplier out for a fortnight and the results
-- are still bent three years later.

CREATE TABLE "listing_boost" (
  "id"            TEXT NOT NULL,
  "business_id"   TEXT NOT NULL,
  "points"        INTEGER NOT NULL,
  "reason"        TEXT NOT NULL,
  "expires_at"    TIMESTAMP(3) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "listing_boost_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "listing_boost"
  ADD CONSTRAINT "listing_boost_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "listing_boost"
  ADD CONSTRAINT "listing_boost_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A reason that is blank is a reason nobody wrote. Same rule as audit_event.
ALTER TABLE "listing_boost"
  ADD CONSTRAINT "listing_boost_reason_is_written"
  CHECK (length(btrim("reason")) >= 4);

-- A boost that can outrank everything is a boost that replaces the ranking.
ALTER TABLE "listing_boost"
  ADD CONSTRAINT "listing_boost_points_are_bounded"
  CHECK ("points" > 0 AND "points" <= 25);

CREATE INDEX IF NOT EXISTS "listing_boost_business_idx" ON "listing_boost" ("business_id", "expires_at");
CREATE INDEX IF NOT EXISTS "listing_boost_expiry_idx" ON "listing_boost" ("expires_at");
