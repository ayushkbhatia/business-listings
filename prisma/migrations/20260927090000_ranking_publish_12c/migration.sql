-- Board 12c, second pass — the draft, the publish history, and boosts that can
-- name a category.
--
-- Three things, and each is additive. Nothing is dropped and nothing is made
-- stricter on data that already exists, so this applies ahead of the code
-- without the code noticing (`docs/deployments.md` § Ordering).

-- ── 1 · The draft ───────────────────────────────────────────────────────────
--
-- One row, `id = 'current'`, holding the weights an ops lead is working on and
-- the impact preview computed against them. `preview_for` is the exact vector
-- the preview describes: the draft moving past it is what makes the preview
-- stale, and comparing the two is how criterion 7 stops being a timestamp race.

CREATE TABLE "ranking_draft" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "relevance" INTEGER NOT NULL,
    "verification_tier" INTEGER NOT NULL,
    "response_time" INTEGER NOT NULL,
    "spec_completeness" INTEGER NOT NULL,
    "distance" INTEGER NOT NULL,
    "plan_tier" INTEGER NOT NULL,
    "browse_relevance_mode" TEXT NOT NULL DEFAULT 'redistribute',
    "saved_by_id" UUID NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preview_started_at" TIMESTAMP(3),
    "preview_ran_at" TIMESTAMP(3),
    "preview_for" JSONB,
    "preview" JSONB,

    CONSTRAINT "ranking_draft_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ranking_draft"
    ADD CONSTRAINT "ranking_draft_saved_by_id_fkey"
    FOREIGN KEY ("saved_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2 · The publish history ─────────────────────────────────────────────────
--
-- One row per publish, not one per day. The spec asked for a day grain so that
-- the position amendment could diff consecutive rows; that reader shipped as
-- PR 146 and reads `listing_factor_day.weights` instead, so the day grain buys
-- nothing here and would lose what criterion 4 asks for — two publishes in one
-- afternoon are two decisions with two written reasons, and a row keyed by day
-- keeps only the second.
--
-- `day` survives as a column for the 90-day prune and the history tab's
-- grouping. It is deliberately not unique.

CREATE TABLE "ranking_publish" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relevance" INTEGER NOT NULL,
    "verification_tier" INTEGER NOT NULL,
    "response_time" INTEGER NOT NULL,
    "spec_completeness" INTEGER NOT NULL,
    "distance" INTEGER NOT NULL,
    "plan_tier" INTEGER NOT NULL,
    "browse_relevance_mode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "categories_moved" INTEGER,
    "listings_moved" INTEGER,
    "sellers_told" INTEGER,
    "published_by_id" UUID NOT NULL,

    CONSTRAINT "ranking_publish_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ranking_publish_at_idx" ON "ranking_publish"("published_at");
CREATE INDEX "ranking_publish_day_idx" ON "ranking_publish"("day");

ALTER TABLE "ranking_publish"
    ADD CONSTRAINT "ranking_publish_published_by_id_fkey"
    FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3 · Boosts that can name a category ─────────────────────────────────────
--
-- "Thin supply — surfacing the few we have" is a statement about a category,
-- not about one supplier, and the board renders both kinds. So `business_id`
-- becomes nullable and `category_id` joins it, with exactly one of the two set.
--
-- The check is written here because Prisma has no syntax for it and a
-- regeneration would silently drop it; `pnpm check:schema` asserts the
-- constraint exists, the same arrangement as `subscription_change_one_pending`.
--
-- `NOT VALID` is not used: every existing row has a business and no category,
-- so the constraint is true of the table as it stands and validating it costs
-- one scan of a table with tens of rows.

ALTER TABLE "listing_boost" ALTER COLUMN "business_id" DROP NOT NULL;
ALTER TABLE "listing_boost" ADD COLUMN "category_id" TEXT;
ALTER TABLE "listing_boost" ADD COLUMN "emirate" "emirate";

ALTER TABLE "listing_boost"
    ADD CONSTRAINT "listing_boost_one_target"
    CHECK (("business_id" IS NOT NULL) <> ("category_id" IS NOT NULL));

-- An emirate narrows a category boost. On a boost that names a listing it says
-- nothing the listing does not already say, and a column that is sometimes
-- meaningful and sometimes ignored is how two readers come to disagree.
ALTER TABLE "listing_boost"
    ADD CONSTRAINT "listing_boost_emirate_needs_category"
    CHECK ("emirate" IS NULL OR "category_id" IS NOT NULL);

CREATE INDEX "listing_boost_category_idx" ON "listing_boost"("category_id", "expires_at");

ALTER TABLE "listing_boost"
    ADD CONSTRAINT "listing_boost_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
