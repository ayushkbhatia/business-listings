-- Board `12c-s` — a second ranking vector, keyed by trade kind.
--
-- `spec_completeness` is twelve of a hundred points that a service supplier can
-- never earn: services are held out of the spec-template system entirely. The
-- services vector re-points that slot at scope completeness and the distance
-- slot at coverage match, at the same weights, so both vectors keep one shape.
--
-- Additive, and ordered to apply ahead of the code (`docs/deployments.md`
-- § Ordering):
--
--   · every new column has a default, so the code already deployed writes rows
--     this migration accepts;
--   · the goods row keeps `id = 'current'`, which is the only row the code
--     already deployed ever reads or writes;
--   · the singleton check is loosened, never tightened, on data that exists.
--
-- **No services row is inserted.** A missing services row is the state board
-- `12c-s` draws as `DRAFT · NOT PUBLISHED`: services listings go on ranking by
-- the goods vector until an ops lead publishes one, so this migration changes
-- no result anybody sees.

-- ── 1 · The live weights ────────────────────────────────────────────────────

ALTER TABLE "ranking_weights"
  ADD COLUMN IF NOT EXISTS "kind" "trade_kind" NOT NULL DEFAULT 'goods';

-- One ranking was the rule; one ranking *per vector* is the rule now.
ALTER TABLE "ranking_weights" DROP CONSTRAINT IF EXISTS "ranking_weights_is_a_singleton";

CREATE UNIQUE INDEX IF NOT EXISTS "ranking_weights_kind_key" ON "ranking_weights" ("kind");

-- `id` is pinned to the kind rather than dropped. The code before this board
-- reads `id = 'current'`, so the goods row stays exactly where it was.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ranking_weights_one_row_per_kind'
  ) THEN
    ALTER TABLE "ranking_weights"
      ADD CONSTRAINT "ranking_weights_one_row_per_kind"
      CHECK (("kind" = 'goods' AND "id" = 'current') OR ("kind" = 'services' AND "id" = 'services'));
  END IF;
END $$;

-- ── 2 · The draft ───────────────────────────────────────────────────────────

ALTER TABLE "ranking_draft"
  ADD COLUMN IF NOT EXISTS "kind" "trade_kind" NOT NULL DEFAULT 'goods';

CREATE UNIQUE INDEX IF NOT EXISTS "ranking_draft_kind_key" ON "ranking_draft" ("kind");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ranking_draft_one_row_per_kind'
  ) THEN
    ALTER TABLE "ranking_draft"
      ADD CONSTRAINT "ranking_draft_one_row_per_kind"
      CHECK (("kind" = 'goods' AND "id" = 'current') OR ("kind" = 'services' AND "id" = 'services'));
  END IF;
END $$;

-- ── 3 · The publish history ─────────────────────────────────────────────────
--
-- Every existing row published the goods vector; there was no other.

ALTER TABLE "ranking_publish"
  ADD COLUMN IF NOT EXISTS "kind" "trade_kind" NOT NULL DEFAULT 'goods';

CREATE INDEX IF NOT EXISTS "ranking_publish_kind_at_idx" ON "ranking_publish" ("kind", "published_at");

-- ── 4 · What ranked each listing, per night ─────────────────────────────────
--
-- Every night already recorded was ranked by the goods vector.

ALTER TABLE "listing_factor_day"
  ADD COLUMN IF NOT EXISTS "vector" "trade_kind" NOT NULL DEFAULT 'goods';
