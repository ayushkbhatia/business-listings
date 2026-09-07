-- Board 3c — the locations manager.
--
-- Additive throughout: two columns, one table, two constraints, two backfills.
-- Nothing is dropped and nothing is rewritten, so this applies **before** the
-- merge (docs/deployments.md § Ordering) and the running deployment carries on
-- reading a schema that still satisfies it.
--
-- Three things the screen states that the model could not hold:
--
--   1. `geocode_precision`. The board draws `Exact` and `Approx` as different
--      states with different costs, and nothing recorded which a pin was. The
--      cost is not cosmetic: `nearestKm` in lib/db/queries/search.ts ranks a
--      supplier by their nearest branch, and on 2026-09-07 **116 of the 118
--      pinned branches in production sat within the seed's own jitter of their
--      area's centre** — coordinates derived from the area, ranked as distance
--      from the address. The backfill below says so out loud.
--
--   2. `published_at`. `published` is a boolean and the board has three
--      statuses. Draft and hidden differ in one behaviour that matters — board
--      3d offers a hidden branch in its picker and skips a draft — and the
--      difference is "has this ever been live", which is a date rather than a
--      third column competing with the boolean.
--
--   3. `business_coverage`. The delivery chips drive `1h`'s routing and sit
--      beside the facets `1b` filters on, so they are rows in the taxonomy, not
--      strings. Board 2d holds the same rule one screen earlier.
--
-- Every statement is idempotent. `migrate dev` regenerates hand-written DDL and
-- drops what it did not author otherwise.

-- ── 1 · how a pin got where it is ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'geocode_precision') THEN
    CREATE TYPE "geocode_precision" AS ENUM ('exact', 'approximate');
  END IF;
END
$$;

ALTER TABLE "location" ADD COLUMN IF NOT EXISTS "geocode_precision" "geocode_precision";
ALTER TABLE "location" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);

-- ── 2 · the backfill that tells the truth about the existing pins ──────────
--
-- Load-bearing, and it costs something: every currently-pinned branch leaves
-- distance sort until somebody drags its marker. That is the correct direction.
-- Up to this migration nothing in application code had ever written `lat` —
-- only prisma/seed.mts had, and it writes the branch's *area* centroid with
-- about 600 m of jitter on it. Marking those `exact` would be recording a claim
-- already known to be false about 116 rows, so that the ranking could go on
-- being confidently wrong. `scoreDistance(null)` scores an unmeasurable supplier
-- as unknown rather than as far, which is why removing the number costs less
-- than keeping a made-up one.
--
-- Guarded on NULL so a re-run cannot overwrite a pin a seller has since placed.
UPDATE "location"
   SET "geocode_precision" = 'approximate'
 WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL AND "geocode_precision" IS NULL;

-- Every branch that is live now was made live at some point, and the row does
-- not record when. `created_at` is the closest true statement available and it
-- is only ever read as "has this ever been published" — without it, the first
-- seller to hide a branch would see it come back as a draft.
UPDATE "location"
   SET "published_at" = "created_at"
 WHERE "published" AND "published_at" IS NULL;

-- ── 3 · a precision means a pin, and a pin means a precision ───────────────
-- The pair is the whole point of the column: "missing" is `lat IS NULL`, and a
-- third enum value would let a row carry coordinates while claiming to have
-- none. Verified against production before writing: 118 rows with both
-- coordinates, 23 with neither, none with one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_precision_matches_pin'
  ) THEN
    ALTER TABLE "location"
      ADD CONSTRAINT "location_precision_matches_pin"
      CHECK (
        ("lat" IS NULL AND "lng" IS NULL AND "geocode_precision" IS NULL)
        OR ("lat" IS NOT NULL AND "lng" IS NOT NULL AND "geocode_precision" IS NOT NULL)
      );
  END IF;
END
$$;

-- ── 4 · where a supplier delivers, and how fast ────────────────────────────
CREATE TABLE IF NOT EXISTS "business_coverage" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "emirate"         "emirate" NOT NULL,
  "area_id"         TEXT,
  "lead_time_hours" INTEGER NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_coverage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "business_coverage_business_id_idx"
  ON "business_coverage" ("business_id");
CREATE INDEX IF NOT EXISTS "business_coverage_emirate_idx"
  ON "business_coverage" ("emirate");
CREATE INDEX IF NOT EXISTS "business_coverage_area_id_idx"
  ON "business_coverage" ("area_id");

-- One promise per scope, and two indexes rather than one because Postgres
-- treats NULLs as distinct in a unique index: `(business, emirate, NULL)` would
-- happily duplicate, which is the row a seller creates by clicking "Dubai"
-- twice. Partial indexes rather than `NULLS NOT DISTINCT` so this applies on a
-- server older than 15 as well.
CREATE UNIQUE INDEX IF NOT EXISTS "business_coverage_business_id_area_id_key"
  ON "business_coverage" ("business_id", "area_id") WHERE "area_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "business_coverage_business_id_emirate_key"
  ON "business_coverage" ("business_id", "emirate") WHERE "area_id" IS NULL;

-- Same day is 0. A negative promise is not a faster one, and past a fortnight
-- the number has stopped describing delivery.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_coverage_lead_time_is_a_promise'
  ) THEN
    ALTER TABLE "business_coverage"
      ADD CONSTRAINT "business_coverage_lead_time_is_a_promise"
      CHECK ("lead_time_hours" >= 0 AND "lead_time_hours" <= 336);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_coverage_business_id_fkey'
  ) THEN
    ALTER TABLE "business_coverage"
      ADD CONSTRAINT "business_coverage_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_coverage_area_id_fkey'
  ) THEN
    ALTER TABLE "business_coverage"
      ADD CONSTRAINT "business_coverage_area_id_fkey"
      FOREIGN KEY ("area_id") REFERENCES "area"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
