-- The enquiry gets a real area — stage 6's third migration.
--
-- `deliver_to_area` has been free text since handoff 1. `ServiceCoverage` and
-- `BusinessCoverage` are both `(emirate, area_id)`, and `Location` too, so the
-- supply side of this directory has always been able to say *Al Quoz*. The
-- demand side could say *Dubai* and then a string, which means **an area-level
-- coverage match was never computable from the enquiry**: to the fan-out, a
-- contractor covering Al Quoz and one covering the whole emirate looked the
-- same.
--
-- The free text stays. It is what the buyer wrote, and a resolved id is what
-- the taxonomy could make of it — two different claims, and the second does not
-- replace the first. A buyer who types "near the Dragon Mart roundabout" has
-- told a seller something real that no `area` row holds.
--
-- **Additive.** The column is nullable with no default and every existing row
-- keeps `NULL` until the backfill below matches one. Readers that have not
-- learned the column see exactly what they saw before, which is why this
-- applies before the merge rather than after.

ALTER TABLE "enquiry"
  ADD COLUMN IF NOT EXISTS "area_id" TEXT;

-- `RESTRICT`, and the alternative rewrites history. `SET NULL` would turn an
-- enquiry that named Al Quoz into one that named nowhere, silently, on a record
-- a seller has already quoted against. Deleting an area a buyer has used should
-- stop and make somebody decide.
DO $$
BEGIN
  ALTER TABLE "enquiry"
    ADD CONSTRAINT "enquiry_area_id_fkey"
    FOREIGN KEY ("area_id") REFERENCES "area" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "enquiry_area_id_idx" ON "enquiry" ("area_id");

-- ── Backfill: only what matches exactly ───────────────────────────────────
--
-- Case- and space-insensitive equality against `area.name`, and nothing
-- cleverer. A trigram or prefix match would fill more rows and some of them
-- would be wrong — "Industrial Area 1" is a real place in three emirates, and
-- guessing which one a buyer meant is the platform inventing a delivery
-- address on a record a seller prices against.
--
-- Scoped by emirate wherever the enquiry states one, so "Industrial Area 1"
-- on a Sharjah enquiry cannot resolve to the Ajman row. An enquiry with no
-- emirate is matched only when the name is unambiguous across the whole
-- country — `COUNT(*) = 1` below is what enforces that.
UPDATE "enquiry" AS e
SET "area_id" = m.id
FROM (
  SELECT a.id, a.emirate, lower(btrim(a.name)) AS key
  FROM "area" a
) AS m
WHERE e."area_id" IS NULL
  AND e."deliver_to_area" IS NOT NULL
  AND lower(btrim(e."deliver_to_area")) = m.key
  AND e."emirate" IS NOT NULL
  AND e."emirate" = m.emirate;

UPDATE "enquiry" AS e
SET "area_id" = m.id
FROM (
  SELECT min(a.id) AS id, lower(btrim(a.name)) AS key
  FROM "area" a
  GROUP BY lower(btrim(a.name))
  HAVING count(*) = 1
) AS m
WHERE e."area_id" IS NULL
  AND e."deliver_to_area" IS NOT NULL
  AND e."emirate" IS NULL
  AND lower(btrim(e."deliver_to_area")) = m.key;
