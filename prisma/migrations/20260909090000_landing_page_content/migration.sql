-- Board 6a: the content records a landing page publishes on, and the date it
-- prints.
--
-- Idempotent throughout, like every hand-written migration here.
--
-- ## What this adds and why it is not four Json columns
--
-- Board 6a §5 asks for four to six per-scope FAQ rows and five curated related
-- searches, and §the-publish-gate makes the FAQ rows a **publish condition**:
-- four of them, two answerable only for this scope. A gate has to count rows,
-- and counting rows inside a Json blob is a gate nobody can query, index or
-- report on. The admin matrix has to show which scopes are held back by copy;
-- that is a `GROUP BY`, not a scan.
--
-- ## Why one pair of tables serves both landing classes
--
-- 6a is one template rendering two page classes — the 84 category×emirate pages
-- board 6c's matrix links, and the area pages the board draws. §1: "one
-- template, one controller, one scope object". Two sets of content tables would
-- be two sets of publish gates and two chances for one to drift, which is the
-- most repeated defect in this project written into the schema.
--
-- Exactly one parent, enforced. A row with neither is content that renders
-- nowhere; a row with both belongs to two pages at once and would move when
-- either was edited.

-- ── The freshness stamp, and how the sweep knows supply moved ────────────────
--
-- §Freshness: `content_updated_at` moves for exactly three reasons — a listing
-- enters or leaves the scope, a listing in it changes verification tier, or the
-- copy is edited. It does not move for a rebuild. `updated_at` cannot carry
-- this: Prisma moves that whenever any column is touched, including the digest
-- immediately below it.
--
-- The digest is a hash over `business_id:tier` for the scope, sorted. A count
-- alone would miss one supplier being swapped for another, which is precisely
-- the change a reader would call an update.
ALTER TABLE "area_page" ADD COLUMN IF NOT EXISTS "meta_description" TEXT;
ALTER TABLE "area_page" ADD COLUMN IF NOT EXISTS "content_updated_at" TIMESTAMP(3);
ALTER TABLE "area_page" ADD COLUMN IF NOT EXISTS "supply_digest" TEXT;

ALTER TABLE "emirate_page" ADD COLUMN IF NOT EXISTS "meta_description" TEXT;
ALTER TABLE "emirate_page" ADD COLUMN IF NOT EXISTS "content_updated_at" TIMESTAMP(3);
ALTER TABLE "emirate_page" ADD COLUMN IF NOT EXISTS "supply_digest" TEXT;

-- Backfilled from `updated_at` rather than left null. A page that is already
-- published has content, and printing nothing where the board draws a date is a
-- worse first render than printing the last time anything about the row moved.
-- Only ever runs against rows that predate the column.
UPDATE "area_page" SET "content_updated_at" = "updated_at" WHERE "content_updated_at" IS NULL;
UPDATE "emirate_page" SET "content_updated_at" = "updated_at" WHERE "content_updated_at" IS NULL;

-- ── The fourth publish condition's rows ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "landing_faq" (
    "id"              TEXT NOT NULL,
    "area_page_id"    TEXT,
    "emirate_page_id" TEXT,
    "position"        INTEGER NOT NULL,
    "question"        TEXT NOT NULL,
    "answer"          TEXT NOT NULL,
    "scope_specific"  BOOLEAN NOT NULL DEFAULT false,
    "live_token"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "landing_faq_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "landing_related_search" (
    "id"              TEXT NOT NULL,
    "area_page_id"    TEXT,
    "emirate_page_id" TEXT,
    "position"        INTEGER NOT NULL,
    "label"           TEXT NOT NULL,
    "href"            TEXT NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "landing_related_search_pkey" PRIMARY KEY ("id")
);

-- One parent, never two and never none.
DO $$
BEGIN
    ALTER TABLE "landing_faq" ADD CONSTRAINT "landing_faq_one_parent"
        CHECK (num_nonnulls("area_page_id", "emirate_page_id") = 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "landing_related_search" ADD CONSTRAINT "landing_related_search_one_parent"
        CHECK (num_nonnulls("area_page_id", "emirate_page_id") = 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "landing_faq" ADD CONSTRAINT "landing_faq_area_page_id_fkey"
        FOREIGN KEY ("area_page_id") REFERENCES "area_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "landing_faq" ADD CONSTRAINT "landing_faq_emirate_page_id_fkey"
        FOREIGN KEY ("emirate_page_id") REFERENCES "emirate_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "landing_related_search" ADD CONSTRAINT "landing_related_search_area_page_id_fkey"
        FOREIGN KEY ("area_page_id") REFERENCES "area_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "landing_related_search" ADD CONSTRAINT "landing_related_search_emirate_page_id_fkey"
        FOREIGN KEY ("emirate_page_id") REFERENCES "emirate_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reading order is unique per page. Two rows at position 3 render in whatever
-- order the planner returns them, which is a page that reshuffles itself
-- between renders on the one template where stability is the product.
CREATE UNIQUE INDEX IF NOT EXISTS "landing_faq_area_page_id_position_key"
  ON "landing_faq"("area_page_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "landing_faq_emirate_page_id_position_key"
  ON "landing_faq"("emirate_page_id", "position");
CREATE INDEX IF NOT EXISTS "landing_faq_area_page_id_idx" ON "landing_faq"("area_page_id");
CREATE INDEX IF NOT EXISTS "landing_faq_emirate_page_id_idx" ON "landing_faq"("emirate_page_id");

CREATE UNIQUE INDEX IF NOT EXISTS "landing_related_search_area_page_id_position_key"
  ON "landing_related_search"("area_page_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "landing_related_search_emirate_page_id_position_key"
  ON "landing_related_search"("emirate_page_id", "position");
CREATE INDEX IF NOT EXISTS "landing_related_search_area_page_id_idx"
  ON "landing_related_search"("area_page_id");
CREATE INDEX IF NOT EXISTS "landing_related_search_emirate_page_id_idx"
  ON "landing_related_search"("emirate_page_id");

-- ── The relevance weight that has no query to score ─────────────────────────
--
-- Board 6a §Ranking. The landing pages read the same weights board 12c edits,
-- and `relevance` — the largest of the six at 34 — has nothing to score against
-- on a page with no search box. Redistributing it is the recommendation; the
-- column exists so the decision is written down in the config rather than
-- implied by a route, and so the other mode can be chosen without a deploy.
ALTER TABLE "ranking_weights" ADD COLUMN IF NOT EXISTS "browse_relevance_mode" TEXT NOT NULL DEFAULT 'redistribute';

DO $$
BEGIN
    ALTER TABLE "ranking_weights" ADD CONSTRAINT "ranking_weights_browse_relevance_mode_known"
        CHECK ("browse_relevance_mode" IN ('redistribute', 'category_depth'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
