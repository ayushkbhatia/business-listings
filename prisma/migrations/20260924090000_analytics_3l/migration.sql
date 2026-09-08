-- Board 3l — the analytics event pipeline.
--
-- Additive. Four new tables, one new enum, one nullable column on `enquiry`,
-- and no change to anything that already holds data. Safe to apply before the
-- code that reads it — docs/deployments.md § Ordering.
--
-- ## Why tables and not a reporting query
--
-- Three of the five funnel stages had no source at all. `SearchQueryLog` records
-- what a buyer typed and how many results came back, and never which businesses
-- were in them; nothing anywhere counted a buyer looking at a *product*. Those
-- are not derivable from the transactional tables at any later date — an
-- impression that was not written is gone — which is why board 3l's `B1` calls
-- the event schema the first deliverable and why this migration leads.
--
-- ## Why every one of them is a daily rollup
--
-- This directory is built to be crawled. One search returning twenty listings
-- is twenty impressions, and at row-per-impression the largest table in the
-- product would be one nobody reads a single row of. The grain here is the
-- smallest one any surface actually asks a question at — a business, a day, and
-- whichever of query / category / product / device the panel groups by — so a
-- page of twenty results costs twenty upserts and a thousand repeat searches
-- cost nothing beyond an increment.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Search impressions, which are also the query position snapshot
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "search_impression_day" (
  "business_id" TEXT NOT NULL,
  "day"         DATE NOT NULL,
  "normalised"  TEXT NOT NULL,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "best_rank"   INTEGER NOT NULL,
  CONSTRAINT "search_impression_day_pkey" PRIMARY KEY ("business_id", "day", "normalised")
);

DO $$ BEGIN
  ALTER TABLE "search_impression_day"
    ADD CONSTRAINT "search_impression_day_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A rank is a position in a list, so it starts at one. A zero here would be a
-- write path that forgot to add the offset, and it would read as "better than
-- first" everywhere the column is ordered.
ALTER TABLE "search_impression_day" DROP CONSTRAINT IF EXISTS "search_impression_day_rank_is_a_position";
ALTER TABLE "search_impression_day" ADD CONSTRAINT "search_impression_day_rank_is_a_position"
  CHECK ("best_rank" >= 1);

CREATE INDEX IF NOT EXISTS "search_impression_day_business_idx"
  ON "search_impression_day" ("business_id", "day");
CREATE INDEX IF NOT EXISTS "search_impression_day_day_idx"
  ON "search_impression_day" ("day");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Category position, the *other* position object
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Board 3a's card and board 3l's query panel are two different numbers, and the
-- spec is explicit that they must not share a table: `3a` is your rank in a
-- category listing and the query panel is your rank for a phrase somebody
-- typed. One table would put two questions behind one answer.

CREATE TABLE IF NOT EXISTS "category_position_day" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "emirate"     "emirate",
  "day"         DATE NOT NULL,
  "position"    INTEGER NOT NULL,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "category_position_day_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "category_position_day"
    ADD CONSTRAINT "category_position_day_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "category_position_day"
    ADD CONSTRAINT "category_position_day_category_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "category_position_day" DROP CONSTRAINT IF EXISTS "category_position_day_rank_is_a_position";
ALTER TABLE "category_position_day" ADD CONSTRAINT "category_position_day_rank_is_a_position"
  CHECK ("position" >= 1);

-- The identity, and the reason the primary key is a surrogate.
--
-- `emirate` is null when the buyer browsed the category across the whole
-- country, which is a real scope rather than missing data — so it belongs in
-- the identity. Prisma refuses an `@@id` over an optional field, and a plain
-- unique index would not help either: in SQL a null never equals a null, so two
-- country-wide rows for one business on one day would both be accepted and the
-- rollup would count the same browse twice for ever.
--
-- Two partial indexes rather than one over `coalesce(emirate::text, '')`:
-- casting an enum to text is STABLE and not IMMUTABLE — labels can be renamed —
-- so Postgres refuses that expression in an index at all. These two are
-- immutable, they cover the two scopes exactly, and `ON CONFLICT` infers
-- whichever one matches the predicate it is given.
--
-- Same shape as `subscription_change_one_pending`: an invariant the schema file
-- cannot express, written once here and asserted by `pnpm check:schema`.
CREATE UNIQUE INDEX IF NOT EXISTS "category_position_day_in_emirate"
  ON "category_position_day" ("business_id", "category_id", "day", "emirate")
  WHERE "emirate" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "category_position_day_countrywide"
  ON "category_position_day" ("business_id", "category_id", "day")
  WHERE "emirate" IS NULL;

CREATE INDEX IF NOT EXISTS "category_position_day_business_idx"
  ON "category_position_day" ("business_id", "day");
CREATE INDEX IF NOT EXISTS "category_position_day_day_idx"
  ON "category_position_day" ("day");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Product views — the funnel stage with no source at all
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "product_view_day" (
  "product_id"  TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "day"         DATE NOT NULL,
  "views"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_view_day_pkey" PRIMARY KEY ("product_id", "day")
);

DO $$ BEGIN
  ALTER TABLE "product_view_day"
    ADD CONSTRAINT "product_view_day_product_fkey"
    FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_view_day"
    ADD CONSTRAINT "product_view_day_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "product_view_day_business_idx"
  ON "product_view_day" ("business_id", "day");
CREATE INDEX IF NOT EXISTS "product_view_day_day_idx"
  ON "product_view_day" ("day");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Device split
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Three buckets and no more. A device string is a fingerprinting surface, and
-- the only question any screen asks of it is whether the buyer web needs a
-- mobile pass — which three buckets answer.

DO $$ BEGIN
  CREATE TYPE "device_kind" AS ENUM ('mobile', 'desktop', 'tablet');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "listing_device_day" (
  "business_id" TEXT NOT NULL,
  "day"         DATE NOT NULL,
  "device"      "device_kind" NOT NULL,
  "views"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "listing_device_day_pkey" PRIMARY KEY ("business_id", "day", "device")
);

DO $$ BEGIN
  ALTER TABLE "listing_device_day"
    ADD CONSTRAINT "listing_device_day_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "listing_device_day_day_idx"
  ON "listing_device_day" ("day");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The emirate the enquiry form already collected and threw away
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The RFQ composer has always asked for it and `lib/enquiry/fanout.ts` has
-- always routed on it. The write kept only the free-text `deliver_to_area`
-- beside it, so the one piece of first-party geography a buyer actually states
-- was the one thing not stored — and board 3l's fourth panel had nothing but a
-- guessed IP country to fall back on.
--
-- Nullable, and the null is a real answer the panel renders as "Not stated".
-- Not backfilled: 14 of 158 existing enquiries carry a free-text area, and
-- parsing prose into an emirate would invent geography for the other 144.

ALTER TABLE "enquiry" ADD COLUMN IF NOT EXISTS "emirate" "emirate";

CREATE INDEX IF NOT EXISTS "enquiry_emirate_created_idx"
  ON "enquiry" ("emirate", "created_at");
