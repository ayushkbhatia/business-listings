-- Search position and ranking attribution — the `3a` + `3l` amendment.
--
-- Board 3l shipped two position objects and a rule that neither of them could
-- keep. `SearchImpressionDay` and `CategoryPositionDay` are written when a buyer
-- loads a page, so a category nobody browsed has no row, and an arrow computed
-- across that hole compares Monday to Thursday and calls it a day's movement.
-- And `3l` §B3 requires every attribution sentence to trace to "a factor
-- changed, by how much, in the window" over history the platform never kept:
-- `business.response_time_median_ms`, `profile_strength` and `spec_completeness`
-- are current-value columns the nightly jobs overwrite.
--
-- Three changes, all additive. Nothing rewrites an existing row.
--
--   1. `category_rank_day`   the nightly snapshot — position and denominator,
--                            true whether anybody looked or not
--   2. `listing_factor_day`  what the ranker saw: six scores, six weights, the
--                            boost, per business per day
--   3. `search_impression_day.result_total`, so a query rank renders `#2 of 34`
--
-- The two tables join the 90-day prune in `lib/analytics/retention.ts`, which
-- goes from four tables to six.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The nightly category rank
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Beside `category_position_day` rather than inside it, because the two answer
-- different questions and only one of them can be measured without a buyer.
-- That table holds impressions, which only a real buyer generates; this holds
-- the position, which is true on a day nobody searched.
--
-- `total` is stored rather than derived at read time. A category that grew from
-- five listings to forty would otherwise restate every historical rank against
-- today's denominator — the same class of lie as a hardcoded count, and harder
-- to spot because every individual number would still be a query.

CREATE TABLE IF NOT EXISTS "category_rank_day" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "emirate"     "emirate",
  "day"         DATE NOT NULL,
  "position"    INTEGER NOT NULL,
  "total"       INTEGER NOT NULL,
  CONSTRAINT "category_rank_day_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "category_rank_day"
    ADD CONSTRAINT "category_rank_day_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "category_rank_day"
    ADD CONSTRAINT "category_rank_day_category_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "category_rank_day" DROP CONSTRAINT IF EXISTS "category_rank_day_rank_is_a_position";
ALTER TABLE "category_rank_day" ADD CONSTRAINT "category_rank_day_rank_is_a_position"
  CHECK ("position" >= 1);

-- A rank cannot exceed its own denominator.
--
-- `#7 of 5` is not a near miss, it is a job that ranked one set and counted
-- another. The check is cheap and the failure it catches is silent: both
-- numbers render, both look like numbers, and only their relationship is wrong.
ALTER TABLE "category_rank_day" DROP CONSTRAINT IF EXISTS "category_rank_day_rank_within_total";
ALTER TABLE "category_rank_day" ADD CONSTRAINT "category_rank_day_rank_within_total"
  CHECK ("position" <= "total");

-- The identity, in two partial indexes, for the reason `category_position_day`
-- documents at length: `emirate` is nullable, it belongs in the identity, and
-- in SQL a null never equals a null — so one plain unique index would accept
-- two country-wide rows for one business on one day. Casting the enum to text
-- is STABLE rather than IMMUTABLE, so `coalesce(emirate::text, '')` is not an
-- option in an index at all.
CREATE UNIQUE INDEX IF NOT EXISTS "category_rank_day_in_emirate"
  ON "category_rank_day" ("business_id", "category_id", "day", "emirate")
  WHERE "emirate" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "category_rank_day_countrywide"
  ON "category_rank_day" ("business_id", "category_id", "day")
  WHERE "emirate" IS NULL;

CREATE INDEX IF NOT EXISTS "category_rank_day_business_idx"
  ON "category_rank_day" ("business_id", "day");
CREATE INDEX IF NOT EXISTS "category_rank_day_day_idx"
  ON "category_rank_day" ("day");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Factor history — what the ranker saw
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Vectors rather than six named columns. Six columns would be six migrations
-- the first time board 12c moves the factor set, and moving it is exactly that
-- board's job.
--
-- Storing the *weights* per day rather than per change is what makes state 09
-- free: a staff slider move shifts every listing in a category and none of them
-- did anything, and diffing two days of this column is how attribution knows
-- that. Without it every such fall is billed to the seller, which is the defect
-- this amendment exists to stop.

CREATE TABLE IF NOT EXISTS "listing_factor_day" (
  "business_id"  TEXT NOT NULL,
  "day"          DATE NOT NULL,
  "scores"       JSONB NOT NULL,
  "raw"          JSONB NOT NULL,
  "weights"      JSONB NOT NULL,
  "boost_points" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "listing_factor_day_pkey" PRIMARY KEY ("business_id", "day")
);

DO $$ BEGIN
  ALTER TABLE "listing_factor_day"
    ADD CONSTRAINT "listing_factor_day_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The three vectors are objects, not arrays and not scalars.
--
-- A JSONB column will accept `4` or `"none"` as happily as an object, and the
-- reader would then throw on a row that inserted cleanly a month earlier.
ALTER TABLE "listing_factor_day" DROP CONSTRAINT IF EXISTS "listing_factor_day_vectors_are_objects";
ALTER TABLE "listing_factor_day" ADD CONSTRAINT "listing_factor_day_vectors_are_objects"
  CHECK (
    jsonb_typeof("scores")  = 'object' AND
    jsonb_typeof("raw")     = 'object' AND
    jsonb_typeof("weights") = 'object'
  );

CREATE INDEX IF NOT EXISTS "listing_factor_day_day_idx"
  ON "listing_factor_day" ("day");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A query rank gains its denominator
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `#2` alone is flattery in a set of three, and the cold-start state is the one
-- this platform launches in. Nullable, and it stays nullable: rows written
-- before this migration have no denominator, and back-filling one from today's
-- result count would restate history against a set that did not exist then.
-- Those rows render their rank alone until the 30-day window rolls past.

ALTER TABLE "search_impression_day" ADD COLUMN IF NOT EXISTS "result_total" INTEGER;
