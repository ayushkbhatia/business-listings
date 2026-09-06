-- Board 4e — the spec library gets its publish path, and templates stop
-- belonging to exactly one category.
--
-- Three changes, and the middle one is the reason the other two are here.
--
--   1. `varies_by_variant` on a platform field. Board 3g reads it to decide
--      what a push-to-variants may touch; a clone can only inherit a flag the
--      library template carries, so it has to be authored here.
--
--   2. `spec_template_category` — the many-to-many. A subcategory holds
--      several templates (grooved, threaded, flanged and press fittings share
--      almost no fields) and a template serves several subcategories. The old
--      `spec_template.category_id` said neither was possible, and coverage —
--      the number this screen exists to move — is a query over this table.
--
--   3. `draft_changes` — ops's unapplied edits, on the row rather than in a
--      second row, for the same reason a version is a bump and not a clone:
--      `product.spec_values` is keyed by `spec_field.id`.
--
-- Every statement is idempotent. `migrate dev` regenerates hand-written DDL
-- and drops what it did not author otherwise.

-- ── 1 · varies_by_variant ──────────────────────────────────────────────────
ALTER TABLE "spec_field"
  ADD COLUMN IF NOT EXISTS "varies_by_variant" BOOLEAN NOT NULL DEFAULT false;

-- ── 2 · the many-to-many ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "spec_template_category" (
  "template_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  CONSTRAINT "spec_template_category_pkey" PRIMARY KEY ("template_id", "category_id")
);

CREATE INDEX IF NOT EXISTS "spec_template_category_category_id_idx"
  ON "spec_template_category" ("category_id");

DO $$
BEGIN
  ALTER TABLE "spec_template_category"
    ADD CONSTRAINT "spec_template_category_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "spec_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "spec_template_category"
    ADD CONSTRAINT "spec_template_category_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill from the column it replaces, while that column still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'spec_template' AND column_name = 'category_id'
  ) THEN
    INSERT INTO "spec_template_category" ("template_id", "category_id")
    SELECT "id", "category_id" FROM "spec_template"
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── 2b · the default a seller is offered first ─────────────────────────────
--
-- `category.default_template_id` is how every product-side reader resolves a
-- template, and the seeded pump catalogue never set one: the buyer-facing
-- facet rail found the pump template through `spec_template.category_id` while
-- `templateForCategory` found nothing, so a pump seller's required fields were
-- never enforced. Two resolvers, one catalogue, different answers. Dropping
-- `category_id` below removes the first of them, so the backfill is what keeps
-- those categories resolving at all.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'spec_template' AND column_name = 'category_id'
  ) THEN
    UPDATE "category" AS c
    SET "default_template_id" = pick.template_id
    FROM (
      SELECT DISTINCT ON (t."category_id")
             t."category_id" AS category_id,
             t."id"          AS template_id
      FROM "spec_template" AS t
      WHERE t."status" = 'live'
      ORDER BY t."category_id", t."version" DESC, t."id"
    ) AS pick
    WHERE c."id" = pick.category_id
      AND c."default_template_id" IS NULL;
  END IF;
END $$;

ALTER TABLE "spec_template" DROP CONSTRAINT IF EXISTS "spec_template_category_id_fkey";
DROP INDEX IF EXISTS "spec_template_category_id_version_key";
DROP INDEX IF EXISTS "spec_template_category_id_idx";
ALTER TABLE "spec_template" DROP COLUMN IF EXISTS "category_id";

CREATE INDEX IF NOT EXISTS "spec_template_status_idx" ON "spec_template" ("status");

-- ── 3 · the draft ──────────────────────────────────────────────────────────
ALTER TABLE "spec_template"
  ADD COLUMN IF NOT EXISTS "draft_changes" JSONB;
