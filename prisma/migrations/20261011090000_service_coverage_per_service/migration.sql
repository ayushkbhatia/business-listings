-- Per-service coverage — board `3c-s`'s owed half, and the reason `1g-s` B8's
-- `effectiveCoverage` has had an unreachable branch since it shipped.
--
-- `service_coverage` has held exactly one kind of row since `2d-s`: the
-- business default, *where this firm works*. `effectiveCoverage(default, own)`
-- was written, tested and called on the public service page, and `own` was
-- always empty because nothing could write it. A resolver whose interesting
-- branch no table can reach is a reader with no writer pointed the other way.
--
-- One nullable column is the whole model. `service_id IS NULL` is the business
-- default; `service_id = <id>` is that service narrowing itself. B5 says the
-- default is inherited at read time and never copied down, so there is no
-- third state to store and no `inherits` flag that could disagree with the
-- rows.
--
-- **Additive.** Every existing row keeps `service_id IS NULL` and every reader
-- that has not yet learned the column sees exactly what it saw before, which
-- is why this applies before the merge rather than after.

ALTER TABLE "service_coverage"
  ADD COLUMN IF NOT EXISTS "service_id" TEXT;

-- `CASCADE`, and the alternative is worse than untidy. `SET NULL` on a deleted
-- service would promote that service's narrowed rows into the business
-- default — deleting a service would silently *widen* what the listing claims,
-- which is the one direction a coverage claim must never move by accident.
DO $$
BEGIN
  ALTER TABLE "service_coverage"
    ADD CONSTRAINT "service_coverage_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "service" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "service_coverage_service_id_idx"
  ON "service_coverage" ("service_id");

-- The two partial uniques from `2d-s` become four, because they were written
-- when every row belonged to the business. Left as they are, a business that
-- covers Dubai makes Dubai unclaimable by any of its services: the default row
-- already occupies `(business_id, 'dubai')`.
--
-- Still partial rather than `NULLS NOT DISTINCT`, for `2d-s`'s reason — it
-- holds on a server older than 15 — and the two original names are kept on the
-- two default-row indexes rather than renamed, so the assertion in
-- `scripts/check-schema-invariants.sh` keeps testing the thing it was written
-- to test instead of finding its own name in an older migration file.
DROP INDEX IF EXISTS "service_coverage_business_id_area_id_key";
DROP INDEX IF EXISTS "service_coverage_business_id_emirate_key";

CREATE UNIQUE INDEX IF NOT EXISTS "service_coverage_business_id_area_id_key"
  ON "service_coverage" ("business_id", "area_id")
  WHERE "area_id" IS NOT NULL AND "service_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "service_coverage_business_id_emirate_key"
  ON "service_coverage" ("business_id", "emirate")
  WHERE "area_id" IS NULL AND "service_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "service_coverage_service_id_area_id_key"
  ON "service_coverage" ("service_id", "area_id")
  WHERE "area_id" IS NOT NULL AND "service_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "service_coverage_service_id_emirate_key"
  ON "service_coverage" ("service_id", "emirate")
  WHERE "area_id" IS NULL AND "service_id" IS NOT NULL;

-- A service row carries `business_id` as well, denormalised, because every
-- reader downstream — the fan-out matcher, the facets, the strength job — asks
-- "which emirates does this business reach" and none of them should have to
-- join `service` to find out.
--
-- That it agrees with the service's own `business_id` is a service-layer
-- guarantee, not a database one: expressing it as a composite foreign key
-- needs a second unique index on `service (id, business_id)` and makes
-- `business_id` a member of two relations, which Prisma models badly. Every
-- writer resolves the service by `{ id, businessId }` from the seat before it
-- writes — the same shape `resolveScope` already uses — and
-- `tests/integration/service-coverage-3cs.test.ts` asserts another business's
-- service is refused.
