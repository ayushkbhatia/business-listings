-- Task T2.5 — the indexes the SQL ranking needs at 41,000 listings.
--
-- Purely **additive**: five indexes, no column, no constraint, no data. By
-- `docs/deployments.md` § Ordering that means it applies *before* the merge
-- that reads it, and nothing on `main` reads it until then.
--
-- Hand-written and idempotent, which is this project's rule for an index:
-- `prisma migrate dev` drops anything it did not generate from the schema, so
-- an index expressed only here has to survive being regenerated. Every
-- statement is `IF NOT EXISTS`.
--
-- ## Not CONCURRENTLY, and when that changes
--
-- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, and every
-- migration here applies inside one. Production holds a few hundred listings
-- today, so each of these builds in milliseconds under a brief lock. **The
-- import changes that**: at 41,000 rows these are seconds, not milliseconds,
-- and the next index added after the import lands should be built
-- `CONCURRENTLY` outside the migration runner — which is a note for T5.4, not
-- a thing to pretend about here.

-- ── 1 · The public scoring set ──────────────────────────────────────────────
--
-- `rankedPage` scores every matched row on six factors and sorts by the
-- result, so the sort reads `verification_tier`, `response_time_median_ms`,
-- `spec_completeness` and `plan_id` for all of them. Carried as `INCLUDE`
-- columns on a partial index over exactly the public set, so the common case —
-- a shelf or an empty search, where the predicate *is* "public" — is an
-- index-only scan rather than 38,687 heap fetches.
--
-- Partial rather than whole: a draft or suspended listing is never in a public
-- result, and an index that carries them is an index whose every scan filters
-- them out again.
CREATE INDEX IF NOT EXISTS "business_public_scoring_idx"
  ON "business" ("id")
  INCLUDE ("verification_tier", "response_time_median_ms", "spec_completeness", "plan_id")
  WHERE "suspended_at" IS NULL AND "published_at" IS NOT NULL;

-- ── 2 · A firm's published branches ─────────────────────────────────────────
--
-- Every place filter is `EXISTS (… WHERE business_id = ? AND published = true
-- AND emirate/area …)`, and `location_business_id_idx` stops at the first
-- column — so the emirate and the area are filtered after the fetch. One
-- composite answers the whole clause from the index.
CREATE INDEX IF NOT EXISTS "location_published_place_idx"
  ON "location" ("business_id", "published", "emirate", "area_id");

-- ── 3 · The branches distance can actually be measured from ─────────────────
--
-- `measurable()` counts an exact pin and nothing else, because an approximate
-- pin is the area's centroid and the kilometres it yields are the distance to
-- the area wearing the address's clothes. A quarter of branches are pinned on
-- the harness and 116 of 118 in production were approximate, so the lateral
-- that computes the nearest pin is looking for a small minority — which is
-- what a partial index is for.
CREATE INDEX IF NOT EXISTS "location_exact_pin_idx"
  ON "location" ("business_id")
  WHERE "published" = true AND "geocode_precision" = 'exact';

-- ── 4 · The catalogue clauses ───────────────────────────────────────────────
--
-- The availability filter and every spec facet are
-- `EXISTS (… WHERE business_id = ? AND status <> 'draft' AND …)`.
-- `product_business_id_idx` leads with the right column and carries neither of
-- the other two.
CREATE INDEX IF NOT EXISTS "product_business_status_availability_idx"
  ON "product" ("business_id", "status", "availability");

-- ── 5 · The emirate shelf, driven from the location side ────────────────────
--
-- `/dubai/…` and the emirate facet match 21,227 of 38,687 rows on the harness,
-- and the planner is better off starting from the locations and semi-joining
-- the businesses. `location_emirate_idx` gives it the emirate and then needs a
-- heap fetch per row for `published` and `business_id`.
CREATE INDEX IF NOT EXISTS "location_emirate_published_idx"
  ON "location" ("emirate", "published", "business_id");
