-- Board 2c: how many categories a plan allows, and whether the licence covers
-- the ones a seller picked.

-- AlterTable — the cap, including the primary category.
--
-- Board 2c counts it two ways on one screen and both are right: the extras
-- allowance is this number minus the primary, and the strength meter counts the
-- total. Null is unlimited, the same convention as the other caps on this table.
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "category_limit" INTEGER;

-- Free lists in one category, Basic in three, Pro in as many as it likes.
--
-- Written here rather than left to the seed, because the seed truncates and a
-- deployed database is not reseeded: without this, every existing plan row
-- would read "unlimited" the moment the screen shipped.
UPDATE "plan" SET "category_limit" = 1 WHERE "id" = 'free' AND "category_limit" IS NULL;
UPDATE "plan" SET "category_limit" = 3 WHERE "id" = 'basic' AND "category_limit" IS NULL;

-- AlterTable — the licence's own words for what the business trades in.
--
-- Prose, not a code: the exports word it differently per emirate and free zone,
-- and a normalised enum would be a mapping table that is wrong for the
-- thirty-seventh authority.
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "licence_activity" TEXT;

-- Backfill from the staging rows that produced these listings, where the import
-- kept one. `staged_listing.business_id` is set when a run is approved, so this
-- is the same fact travelling the last step it never took.
UPDATE "business" b
   SET "licence_activity" = s."activity"
  FROM "staged_listing" s
 WHERE s."business_id" = b."id"
   AND s."activity" IS NOT NULL
   AND b."licence_activity" IS NULL;

-- AlterTable — the flag, and who cleared it.
ALTER TABLE "business_category" ADD COLUMN IF NOT EXISTS "unverified_activity_at" TIMESTAMP(3);
ALTER TABLE "business_category" ADD COLUMN IF NOT EXISTS "cleared_by_id" UUID;

-- CreateIndex — the reviewer's queue: every flag still standing.
CREATE INDEX IF NOT EXISTS "business_category_unverified_activity_at_idx"
  ON "business_category"("unverified_activity_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "business_category" ADD CONSTRAINT "business_category_cleared_by_id_fkey"
    FOREIGN KEY ("cleared_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
