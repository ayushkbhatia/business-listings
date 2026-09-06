-- Board 6d: the guide article, and the two dates that keep it honest.
--
-- Idempotent throughout, like every hand-written migration here.
--
-- ## Why a guide carries two dates
--
-- Guides make factual claims about the world — a named authority, a VAT rate, a
-- renewal cadence — and those change. An article with a 2026 publication date
-- and 2029 traffic is a liability on a page whose whole subject is
-- trustworthiness.
--
--   published_at             set once, never moves
--   regulatory_checked_at    moves when an editor re-checks the external facts
--
-- `Article.datePublished` renders the first and `dateModified` the second.
-- Neither moves on a rebuild, a redeploy or a typo fix — the same rule
-- `area_page.content_updated_at` and `curated_list.audited_at` already follow,
-- and for the same reason: a date that tracks the build is always today and
-- therefore says nothing.
--
-- ## Overdue does not unpublish
--
-- The deliberate difference from a curated list. A stale list misrepresents
-- named sellers; a stale guide is merely old. Overdue articles surface in the
-- board 6f queue and stay live, and if a specific claim is found wrong the fix
-- is an edit and a new `regulatory_checked_at` rather than a takedown.

ALTER TABLE "guide" ADD COLUMN IF NOT EXISTS "byline_role" TEXT;
ALTER TABLE "guide" ADD COLUMN IF NOT EXISTS "topic" TEXT;
ALTER TABLE "guide" ADD COLUMN IF NOT EXISTS "standfirst" TEXT;
ALTER TABLE "guide" ADD COLUMN IF NOT EXISTS "regulatory_checked_at" TIMESTAMP(3);
ALTER TABLE "guide" ADD COLUMN IF NOT EXISTS "review_cadence_months" INTEGER;

-- Backfilled from the publication date, and only where a guide is already
-- published: on the day it went out, its facts had just been checked. Leaving
-- it null would render every existing article as never-checked, which is a
-- worse claim than the true one.
UPDATE "guide"
   SET "regulatory_checked_at" = "published_at"
 WHERE "regulatory_checked_at" IS NULL AND "published_at" IS NOT NULL;

-- The overdue queue reads this. Partial: an article with no cadence makes no
-- claim about the world and is never overdue, so it is not a row to walk.
CREATE INDEX IF NOT EXISTS "guide_regulatory_checked_at_idx"
  ON "guide"("regulatory_checked_at")
  WHERE "review_cadence_months" IS NOT NULL;

-- ── Three related guides, chosen by an editor ───────────────────────────────
--
-- A join table rather than an array of ids on `guide`. §6 asks for editorial
-- choice, and the rail's job is partly to point at the article that covers what
-- this one deliberately does not — so a dangling reference is a rail entry
-- promising a page that no longer exists, which an id array has no way to
-- prevent and a foreign key does for free.
CREATE TABLE IF NOT EXISTS "guide_related" (
    "id"       TEXT NOT NULL,
    "from_id"  TEXT NOT NULL,
    "to_id"    TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "guide_related_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    ALTER TABLE "guide_related" ADD CONSTRAINT "guide_related_from_id_fkey"
        FOREIGN KEY ("from_id") REFERENCES "guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "guide_related" ADD CONSTRAINT "guide_related_to_id_fkey"
        FOREIGN KEY ("to_id") REFERENCES "guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An article cannot point at one guide twice, and two rail entries cannot share
-- a position — the rail is three links in an order an editor chose.
CREATE UNIQUE INDEX IF NOT EXISTS "guide_related_from_id_position_key"
  ON "guide_related"("from_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "guide_related_from_id_to_id_key"
  ON "guide_related"("from_id", "to_id");
CREATE INDEX IF NOT EXISTS "guide_related_to_id_idx" ON "guide_related"("to_id");

-- A guide does not link to itself. It would render a rail entry pointing at the
-- page the reader is on, which is the one link on the page that cannot help.
DO $$
BEGIN
    ALTER TABLE "guide_related" ADD CONSTRAINT "guide_related_not_self"
        CHECK ("from_id" <> "to_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
