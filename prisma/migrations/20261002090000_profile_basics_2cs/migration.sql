-- Board `2c-s`: what a services business does, and who it does it for.
--
-- Three columns on `business` and one materialised table. Additive throughout,
-- so it applies BEFORE the merge that reads it (`docs/deployments.md`
-- § Ordering). Every existing row is valid the moment it exists: the arrays
-- default to empty and the headline is nullable.
--
-- WHY `headline` IS NOT `description`
--
-- `description` is six hundred characters and is the storefront's longer prose;
-- 123 live listings already hold one. The board's one-liner is ninety and shows
-- in every search result. They are different fields doing different jobs, and
-- capping the existing one would truncate live data — which is the same
-- no-conversion rule `4d-s` B5 and `2b-s` B5 both state.
--
-- `ListingCard` prefers `headline` where it exists and falls back to
-- `description`, so a seller who writes one improves their own card and nobody
-- else's changes.
--
-- WHY `sectors_served` IS TEXT AND NOT A FOREIGN KEY
--
-- D3 settled that comparison stays at business level, so there is nothing for a
-- controlled vocabulary to buy here — and a dictionary would recreate the
-- *Other* bucket it exists to avoid. A marine surveyor works with P&I clubs and
-- charterers; a tax practice with free-zone entities and family offices. No list
-- we write covers the tail, and the tail is the point.
--
-- `sector_suggestion` is a materialised view of what sellers actually picked,
-- per category, recomputed nightly. It is never a source of truth: a sector a
-- seller types joins the index and may become a chip for the next one, so the
-- list writes itself from what sellers say rather than from what we guessed.
--
-- WHY THE GOODS COLUMNS ARE NOT TOUCHED
--
-- The board's field swap lists four goods-only fields to remove. **None of them
-- is on this screen in this codebase** — `min_order_qty` and `lead_time_days`
-- are on `product`, `service_radius_km` is on `location`, and brands do not
-- exist at all. There is nothing to remove, and nothing is dropped.
--
-- IDEMPOTENT, AND SAFE TO RUN TWICE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The three columns
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Arrays default to `'{}'` rather than being nullable, so every reader gets a
-- list and none has to decide what a null array means.

ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "headline" TEXT;
ALTER TABLE "business"
  ADD COLUMN IF NOT EXISTS "sectors_served" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "business"
  ADD COLUMN IF NOT EXISTS "services_offered" TEXT[] NOT NULL DEFAULT '{}';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The suggestion index
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Keyed on the category and the case-folded slug, so `Free Zone` and `free zone`
-- are one row. `label` keeps the form most sellers typed, because the chip has
-- to read like the seller's own words rather than like a slug.
--
-- `ON DELETE CASCADE` from the category: a taxonomy row that goes takes its
-- suggestions with it, and they are derivable again from the businesses.

CREATE TABLE IF NOT EXISTS "sector_suggestion" (
  "category_id" TEXT        NOT NULL,
  "slug"        TEXT        NOT NULL,
  "label"       TEXT        NOT NULL,
  "picked_by"   INTEGER     NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sector_suggestion_pkey" PRIMARY KEY ("category_id", "slug")
);

-- Hand-written and therefore guarded, so `migrate dev` cannot generate one that
-- drops it — the trap recorded in the raw-SQL migration rules.
CREATE INDEX IF NOT EXISTS "sector_suggestion_category_id_picked_by_idx"
  ON "sector_suggestion" ("category_id", "picked_by" DESC);

DO $$ BEGIN
  ALTER TABLE "sector_suggestion"
    ADD CONSTRAINT "sector_suggestion_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
