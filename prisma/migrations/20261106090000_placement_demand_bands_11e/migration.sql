-- Board `11e` — sponsored placement is priced from the site's own traffic.
--
-- Until now a slot cost AED 450 everywhere, for every trade, in every emirate,
-- which is the one thing the board says it must not be: *"price tracks demand,
-- not competition."* The model ratified 17 Sep 2026:
--
--   * Every sellable scope — one trade in one emirate — is classified into one
--     of **ten demand bands** from what buyers actually did there. Any number
--     of scopes may sit in a band and there are always ten of them, so the
--     ladder does not stretch as the directory grows; scopes move between the
--     rungs instead.
--   * A band's price is `300 × 1.1^(band − 1)`, from AED 300 at band 1 — which
--     is the floor, deliberately: the quietest page a slot can be bought on is
--     still worth AED 300 a month.
--   * Both the base and the step are **rows**, because the owner asked to move
--     them as we learn what sells without a deploy. Same argument board `12e`
--     makes for plan prices.
--
-- ## Ordering
--
-- **Additive, so it applies before the merge** — `docs/deployments.md`
-- § Ordering. Four new tables and one new nullable column; nothing is dropped
-- and no existing statement changes shape. The deployment now live neither
-- reads nor writes any of it.
--
-- ## Backfill
--
-- The two pricing tables are seeded here, because a rate card with no rows
-- prices nothing and the first read would have to invent a number. The bands
-- are the ratified curve, rounded to the dirham.
--
-- `scope_demand_band` is deliberately **not** backfilled. It is the output of a
-- measurement, and a row written by a migration would be a demand figure nobody
-- measured — the exact thing this project has now caught inventing three times.
-- Until the first run of the classifier every scope reads "not measured yet" and
-- prices at band 1, which is honest and is also the cold-start state the screen
-- is designed for.
--
-- `placement_slot.band` is left NULL on the slots that already exist. They were
-- sold at a flat price before bands existed; stamping one on them now would be
-- a record of a decision nobody took.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · The click half of the demand signal
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Appearances were already counted: `category_position_day` gets a row per
-- listing shown every time a real buyer loads a results page. A click was
-- attributable to nothing — `listing_view_day` knows a storefront had forty
-- views and not which page sent them.
--
-- No `business_id`. This counts demand for a scope, never performance of a
-- listing, so the table cannot be read as who is winning a category.

CREATE TABLE IF NOT EXISTS "scope_click_day" (
  "id"          TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "emirate"     "emirate",
  "day"         DATE NOT NULL,
  "clicks"      INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "scope_click_day_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "scope_click_day" DROP CONSTRAINT IF EXISTS "scope_click_day_category_id_fkey";
ALTER TABLE "scope_click_day"
  ADD CONSTRAINT "scope_click_day_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Two partial uniques, not one plain one.
--
-- Postgres treats two NULLs as distinct, so a unique over
-- (category_id, emirate, day) would not constrain the country-wide row at all
-- and the counter's `ON CONFLICT` would have nothing to land on.
-- `category_position_day` has the same shape and the same pair.
CREATE UNIQUE INDEX IF NOT EXISTS "scope_click_day_national_key"
  ON "scope_click_day" ("category_id", "day")
  WHERE "emirate" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "scope_click_day_emirate_key"
  ON "scope_click_day" ("category_id", "day", "emirate")
  WHERE "emirate" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "scope_click_day_scope_idx"
  ON "scope_click_day" ("category_id", "emirate", "day");

CREATE INDEX IF NOT EXISTS "scope_click_day_day_idx"
  ON "scope_click_day" ("day");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · The band a scope sits in, and what put it there
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One row per sellable scope, rewritten on the first of each month. The score
-- and its two components are stored beside the band so the number a seller is
-- charged from can be taken apart by whoever has to explain it, and
-- `measured_from`/`measured_to` give the figure a vintage instead of leaving it
-- a bare assertion.

CREATE TABLE IF NOT EXISTS "scope_demand_band" (
  "id"            TEXT NOT NULL,
  "category_id"   TEXT NOT NULL,
  "emirate"       "emirate",
  "band"          INTEGER NOT NULL,
  "score"         INTEGER NOT NULL,
  "appearances"   INTEGER NOT NULL,
  "clicks"        INTEGER NOT NULL,
  "measured_from" DATE NOT NULL,
  "measured_to"   DATE NOT NULL,
  "computed_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "scope_demand_band_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "scope_demand_band" DROP CONSTRAINT IF EXISTS "scope_demand_band_category_id_fkey";
ALTER TABLE "scope_demand_band"
  ADD CONSTRAINT "scope_demand_band_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ten bands and no eleventh. The ladder is fixed and the scopes move on it —
-- a band 11 would mean the classifier had started stretching the scale instead,
-- which is the thing the fixed ladder exists to prevent.
ALTER TABLE "scope_demand_band" DROP CONSTRAINT IF EXISTS "scope_demand_band_band_range";
ALTER TABLE "scope_demand_band" ADD CONSTRAINT "scope_demand_band_band_range"
  CHECK ("band" BETWEEN 1 AND 10);

-- The same NULL problem as above, and the same answer.
CREATE UNIQUE INDEX IF NOT EXISTS "scope_demand_band_national_key"
  ON "scope_demand_band" ("category_id")
  WHERE "emirate" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "scope_demand_band_emirate_key"
  ON "scope_demand_band" ("category_id", "emirate")
  WHERE "emirate" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "scope_demand_band_band_idx"
  ON "scope_demand_band" ("band");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · The rate card
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "placement_band" (
  "band"              INTEGER NOT NULL,
  "monthly_price_aed" INTEGER NOT NULL,
  "override"          BOOLEAN NOT NULL DEFAULT false,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "placement_band_pkey" PRIMARY KEY ("band")
);

ALTER TABLE "placement_band" DROP CONSTRAINT IF EXISTS "placement_band_band_range";
ALTER TABLE "placement_band" ADD CONSTRAINT "placement_band_band_range"
  CHECK ("band" BETWEEN 1 AND 10);

-- A slot is never free and never five figures a month. The floor is the
-- ratified 300; the ceiling is where a typed extra digit stops being a price.
ALTER TABLE "placement_band" DROP CONSTRAINT IF EXISTS "placement_band_price_range";
ALTER TABLE "placement_band" ADD CONSTRAINT "placement_band_price_range"
  CHECK ("monthly_price_aed" BETWEEN 1 AND 100000);

CREATE TABLE IF NOT EXISTS "placement_pricing" (
  "id"             TEXT NOT NULL,
  "base_price_aed" INTEGER NOT NULL,
  "step_bps"       INTEGER NOT NULL,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "placement_pricing_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "placement_pricing" DROP CONSTRAINT IF EXISTS "placement_pricing_sane";
ALTER TABLE "placement_pricing" ADD CONSTRAINT "placement_pricing_sane"
  CHECK ("base_price_aed" BETWEEN 1 AND 100000 AND "step_bps" BETWEEN 0 AND 10000);

-- The ratified curve. `300 × 1.1^(band − 1)`, rounded to the dirham.
INSERT INTO "placement_pricing" ("id", "base_price_aed", "step_bps")
VALUES ('current', 300, 1000)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "placement_band" ("band", "monthly_price_aed") VALUES
  (1, 300), (2, 330), (3, 363), (4, 399), (5, 439),
  (6, 483), (7, 531), (8, 585), (9, 643), (10, 707)
ON CONFLICT ("band") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · The band a slot was sold in
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Stored, never recomputed — the rule board `3m` sets for every figure that
-- reaches an invoice. Bands move on the first of each month; a seller who
-- bought in band 4 pays band 4's price until they cancel, and a line that
-- re-derived itself from today's band would restate a charge already sent.

ALTER TABLE "placement_slot" ADD COLUMN IF NOT EXISTS "band" INTEGER;

ALTER TABLE "placement_slot" DROP CONSTRAINT IF EXISTS "placement_slot_band_range";
ALTER TABLE "placement_slot" ADD CONSTRAINT "placement_slot_band_range"
  CHECK ("band" IS NULL OR "band" BETWEEN 1 AND 10);

-- The read index the schema declares beside the two partial uniques above.
CREATE INDEX IF NOT EXISTS "scope_demand_band_scope_idx"
  ON "scope_demand_band" ("category_id", "emirate");
