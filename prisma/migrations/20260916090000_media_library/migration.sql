-- Board 3i — one file, many products, and folders that a file is in exactly one of.
--
-- `media.product_id` and `document.product_id` were single nullable columns, so
-- a photograph belonged to at most one product and the same image had to be
-- uploaded again for the next size in the range. Board 3i's whole premise is
-- the opposite: a file is the library's, referenced from many places, stored
-- once — which is also the answer to board 3g's Q4 about documents.
--
-- Order matters. The join tables are filled from the columns they replace while
-- those columns still exist, and only then are the columns dropped. Every
-- statement is idempotent; `migrate dev` regenerates hand-written DDL and drops
-- what it did not author otherwise.

-- ── 1 · Folders ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "media_folder" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_folder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "media_folder_business_id_name_key"
  ON "media_folder" ("business_id", "name");
CREATE INDEX IF NOT EXISTS "media_folder_business_id_sort_order_idx"
  ON "media_folder" ("business_id", "sort_order");

DO $$ BEGIN
  ALTER TABLE "media_folder" ADD CONSTRAINT "media_folder_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "media"    ADD COLUMN IF NOT EXISTS "folder_id" TEXT;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "folder_id" TEXT;

CREATE INDEX IF NOT EXISTS "media_folder_id_idx"    ON "media" ("folder_id");
CREATE INDEX IF NOT EXISTS "document_folder_id_idx" ON "document" ("folder_id");

DO $$ BEGIN
  ALTER TABLE "media" ADD CONSTRAINT "media_folder_id_fkey"
    FOREIGN KEY ("folder_id") REFERENCES "media_folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "document" ADD CONSTRAINT "document_folder_id_fkey"
    FOREIGN KEY ("folder_id") REFERENCES "media_folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2 · One file, many products ────────────────────────────────────────────
--
-- `sort_order` carries the gallery order board 1g renders, and position 0 is
-- the primary image. No `is_primary` flag: a flag and an order are two sources
-- of truth for one fact, and they drift.
CREATE TABLE IF NOT EXISTS "product_media" (
  "product_id" TEXT NOT NULL,
  "media_id"   TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_media_pkey" PRIMARY KEY ("product_id", "media_id")
);

CREATE INDEX IF NOT EXISTS "product_media_media_id_idx" ON "product_media" ("media_id");
CREATE INDEX IF NOT EXISTS "product_media_product_id_sort_order_idx"
  ON "product_media" ("product_id", "sort_order");

DO $$ BEGIN
  ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_media" ADD CONSTRAINT "product_media_media_id_fkey"
    FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "product_document" (
  "product_id"  TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_document_pkey" PRIMARY KEY ("product_id", "document_id")
);

CREATE INDEX IF NOT EXISTS "product_document_document_id_idx"
  ON "product_document" ("document_id");

DO $$ BEGIN
  ALTER TABLE "product_document" ADD CONSTRAINT "product_document_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_document" ADD CONSTRAINT "product_document_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3 · Backfill, while the columns still exist ────────────────────────────
--
-- `media.sort_order` already held the gallery order two production queries have
-- read since handoff 1, so it carries across rather than being re-derived. Ties
-- resolve by `created_at` then `id`, which is the order those queries were
-- getting by accident.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='media' AND column_name='product_id') THEN
    INSERT INTO "product_media" ("product_id", "media_id", "sort_order")
    SELECT m."product_id", m."id",
           ROW_NUMBER() OVER (PARTITION BY m."product_id"
                              ORDER BY m."sort_order", m."created_at", m."id") - 1
    FROM "media" m
    WHERE m."product_id" IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='document' AND column_name='product_id') THEN
    INSERT INTO "product_document" ("product_id", "document_id", "sort_order")
    SELECT d."product_id", d."id",
           ROW_NUMBER() OVER (PARTITION BY d."product_id"
                              ORDER BY d."created_at", d."id") - 1
    FROM "document" d
    WHERE d."product_id" IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- A product photograph carried no `business_id`, because the product supplied
-- it. The file is the library's now, so it needs its own owner or it vanishes
-- from the seller's library the moment the column goes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='media' AND column_name='product_id') THEN
    UPDATE "media" m
    SET "business_id" = p."business_id"
    FROM "product" p
    WHERE m."product_id" = p."id" AND m."business_id" IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='document' AND column_name='product_id') THEN
    UPDATE "document" d
    SET "business_id" = p."business_id"
    FROM "product" p
    WHERE d."product_id" = p."id" AND d."business_id" IS NULL;
  END IF;
END $$;

-- ── 4 · Drop the columns the joins replace ─────────────────────────────────
ALTER TABLE "media"    DROP CONSTRAINT IF EXISTS "media_product_id_fkey";
ALTER TABLE "document" DROP CONSTRAINT IF EXISTS "document_product_id_fkey";
DROP INDEX IF EXISTS "media_product_id_idx";
DROP INDEX IF EXISTS "document_product_id_idx";
ALTER TABLE "media"    DROP COLUMN IF EXISTS "product_id";
ALTER TABLE "document" DROP COLUMN IF EXISTS "product_id";

-- ── 5 · The storage allowance ──────────────────────────────────────────────
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "storage_mb" INTEGER;
