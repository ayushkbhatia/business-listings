-- Board 3d — hours, holidays and Ramadan.
--
-- Additive throughout: one column, two tables, four constraints. Nothing is
-- dropped, so this applies **before** the merge (docs/deployments.md § Ordering)
-- and the running deployment carries on reading a schema that still satisfies
-- it. It sits on top of board 3c's `20260919090000_locations_manager`, which
-- adds the `published_at` this screen's branch picker reads.
--
-- Three things the screen states that the model could not hold:
--
--   1. `ramadan_confirmed_year`. Ramadan dates and Ramadan hours are different
--      objects with different owners, and the board collapsed them into one
--      `AUTO-APPLIED` label — while board 3a's card told the same seller
--      "Ramadan hours for 2027 unconfirmed" and linked here. Both cannot be
--      true. This is the field 3a's reminder reads and `Confirm` clears.
--
--   2. `public_holiday`. The rail promises official UAE dates are kept current.
--      Nothing held them, so the promise had no table behind it, and a half day
--      rendered a pill and a date with no hours — a setting whose value the
--      seller cannot see.
--
--   3. `location_closure`. The seller's own dates, per branch, which is the
--      other half of that rail and the half they maintain.
--
-- Every statement is idempotent. `migrate dev` regenerates hand-written DDL and
-- drops what it did not author otherwise.

-- ── 1 · the year the seller last confirmed ─────────────────────────────────
-- No backfill, and that is the point: every existing branch is unconfirmed,
-- which is true. Their carried-over Ramadan hours keep applying — an
-- unconfirmed Ramadan is not an unset one, and the alternative is a listing
-- that goes silent for a month.
ALTER TABLE "location" ADD COLUMN IF NOT EXISTS "ramadan_confirmed_year" INTEGER;

-- ── 2 · the official calendar ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public_holiday" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "starts_on"  DATE NOT NULL,
  "ends_on"    DATE NOT NULL,
  "half_day"   BOOLEAN NOT NULL DEFAULT false,
  "open_from"  TEXT,
  "open_until" TEXT,
  "confirmed"  BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_holiday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_holiday_name_starts_on_key"
  ON "public_holiday" ("name", "starts_on");
CREATE INDEX IF NOT EXISTS "public_holiday_starts_on_idx"
  ON "public_holiday" ("starts_on");

-- ── 3 · the seller's own dates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "location_closure" (
  "id"          TEXT NOT NULL,
  "location_id" TEXT NOT NULL,
  "starts_on"   DATE NOT NULL,
  "ends_on"     DATE NOT NULL,
  "reason"      TEXT NOT NULL,
  "open_from"   TEXT,
  "open_until"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "location_closure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "location_closure_location_id_starts_on_idx"
  ON "location_closure" ("location_id", "starts_on");

-- ── 4 · a half day carries its hours, and a window runs forwards ───────────
-- Criterion 8. The board rendered `Half day` beside a date and nothing else,
-- which is a setting the seller cannot see the value of — so the pair is tied
-- in the database rather than remembered in a form. `half_day` on
-- `public_holiday` and the presence of the times on `location_closure` are the
-- same rule written for two tables that record two people's decisions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'public_holiday_half_day_carries_hours'
  ) THEN
    ALTER TABLE "public_holiday"
      ADD CONSTRAINT "public_holiday_half_day_carries_hours"
      CHECK (
        ("half_day" = false AND "open_from" IS NULL AND "open_until" IS NULL)
        OR ("half_day" = true AND "open_from" IS NOT NULL AND "open_until" IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'public_holiday_runs_forwards'
  ) THEN
    ALTER TABLE "public_holiday"
      ADD CONSTRAINT "public_holiday_runs_forwards" CHECK ("ends_on" >= "starts_on");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_closure_half_day_carries_hours'
  ) THEN
    ALTER TABLE "location_closure"
      ADD CONSTRAINT "location_closure_half_day_carries_hours"
      CHECK (
        ("open_from" IS NULL AND "open_until" IS NULL)
        OR ("open_from" IS NOT NULL AND "open_until" IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_closure_runs_forwards'
  ) THEN
    ALTER TABLE "location_closure"
      ADD CONSTRAINT "location_closure_runs_forwards" CHECK ("ends_on" >= "starts_on");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_closure_location_id_fkey'
  ) THEN
    ALTER TABLE "location_closure"
      ADD CONSTRAINT "location_closure_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "location"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 5 · the event behind "we shift them and email you" ─────────────────────
-- ADD VALUE IF NOT EXISTS is not transactional on older servers; guarded so a
-- re-run is a no-op rather than an error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'notification_event' AND e.enumlabel = 'ramadan_dates_moved'
  ) THEN
    ALTER TYPE "notification_event" ADD VALUE 'ramadan_dates_moved';
  END IF;
END
$$;
