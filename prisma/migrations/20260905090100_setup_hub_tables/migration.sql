-- Board 8a: the four things the setup hub needs and the schema did not have.
--
-- Every statement is `IF NOT EXISTS`. A hand-written migration in this repo has
-- to be idempotent or a later `prisma migrate dev` regenerates it as a drop —
-- the indexes on `licence_import_run` were lost that way once already.

-- ── A buyer keeping a supplier for later ────────────────────────────────────
--
-- The right rail's second count. There was no shortlist concept at all, and the
-- nearest thing on offer was a DISTINCT over `contact_reveal.actor_id`, which is
-- null for roughly three quarters of its rows by design. Counting that and
-- calling it "buyers who saved you" is the padded number CLAUDE.md forbids.
CREATE TABLE IF NOT EXISTS "shortlist" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shortlist_pkey" PRIMARY KEY ("id")
);

-- Saving twice is saving once. The unique is what makes the toggle idempotent,
-- so a double-tap on a phone cannot produce two rows and a count of two.
CREATE UNIQUE INDEX IF NOT EXISTS "shortlist_user_id_business_id_key" ON "shortlist"("user_id", "business_id");
-- The seller's count.
CREATE INDEX IF NOT EXISTS "shortlist_business_id_created_at_idx" ON "shortlist"("business_id", "created_at");
-- The buyer's own list.
CREATE INDEX IF NOT EXISTS "shortlist_user_id_created_at_idx" ON "shortlist"("user_id", "created_at");

-- ── Storefront views, rolled up to the day ──────────────────────────────────
--
-- Not a row per view. This product is built to be crawled: 41,000 listings and
-- a search engine that revisits them is a table that grows without a person
-- ever having read anything. The day is Asia/Dubai, so a day is the day the
-- supplier had, and the primary key is the read.
CREATE TABLE IF NOT EXISTS "listing_view_day" (
    "business_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "listing_view_day_pkey" PRIMARY KEY ("business_id","day")
);

-- ── What somebody did ───────────────────────────────────────────────────────
--
-- The first event table in the product. Board 8a asks the question it exists
-- for — what score is a seller at when they stop — and no derived count can
-- answer it, because derived state knows "done" and never knows "when".
--
-- Not `audit_event`: that log is staff decisions and both `actor_id` and
-- `reason` are NOT NULL for that reason. A product event has no reason at all.
CREATE TABLE IF NOT EXISTS "product_event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_id" TEXT,
    "actor_id" UUID,
    "session_id" TEXT,
    "props" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_event_name_created_at_idx" ON "product_event"("name", "created_at");
CREATE INDEX IF NOT EXISTS "product_event_business_id_name_created_at_idx" ON "product_event"("business_id", "name", "created_at");
-- The prune. `search_query_log`, `zero_result_query` and `contact_reveal` all
-- grow forever because none of them has this index and none of them is pruned;
-- this table is pruned in the daily job from the day it exists.
CREATE INDEX IF NOT EXISTS "product_event_created_at_idx" ON "product_event"("created_at");

-- ── "Send us your price list and we will key it in" ─────────────────────────
--
-- A queue, not a parser. `lib/import/service.ts` is the parser and it needs
-- columns; this is for the PDF a supplier has had since 2019, and the work at
-- the other end is a person reading it. `fee_aed` is frozen at the moment of
-- asking, because a price read later is a different price and the seller agreed
-- to this one.
DO $$
BEGIN
    CREATE TYPE "catalogue_import_status" AS ENUM ('requested', 'in_progress', 'loaded', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "catalogue_import_request" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "document_id" TEXT,
    "status" "catalogue_import_status" NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "fee_aed" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3),
    "products_loaded" INTEGER,
    "loaded_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalogue_import_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "catalogue_import_request_business_id_created_at_idx" ON "catalogue_import_request"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "catalogue_import_request_status_created_at_idx" ON "catalogue_import_request"("status", "created_at");

-- ── Foreign keys ────────────────────────────────────────────────────────────
--
-- `requested_by_id` is Restrict rather than Cascade, matching
-- `site_visit_request`: the row is a record of somebody having asked, and a
-- record whose asker can be deleted out from under it is not one.
DO $$
BEGIN
    ALTER TABLE "shortlist" ADD CONSTRAINT "shortlist_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "shortlist" ADD CONSTRAINT "shortlist_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "listing_view_day" ADD CONSTRAINT "listing_view_day_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "product_event" ADD CONSTRAINT "product_event_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "product_event" ADD CONSTRAINT "product_event_actor_id_fkey"
        FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "catalogue_import_request" ADD CONSTRAINT "catalogue_import_request_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "catalogue_import_request" ADD CONSTRAINT "catalogue_import_request_requested_by_id_fkey"
        FOREIGN KEY ("requested_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "catalogue_import_request" ADD CONSTRAINT "catalogue_import_request_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
