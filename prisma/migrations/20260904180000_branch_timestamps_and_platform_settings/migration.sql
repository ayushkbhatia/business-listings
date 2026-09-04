-- Board 2d: when a branch last changed, and where the Ramadan calendar lives.

-- AlterTable — the timestamp the "Saved 20 seconds ago" line in the header reads.
--
-- Two statements rather than one, because `NOT NULL` with no default would
-- refuse on a table that already has rows and a permanent default would leave
-- every future write depending on the database clock rather than on Prisma's
-- `@updatedAt`. Added nullable, backfilled from `created_at` — a branch nobody
-- has edited was last changed when it was made, which is true and is the only
-- honest value available — then tightened.
ALTER TABLE "location" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);
UPDATE "location" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "location" ALTER COLUMN "updated_at" SET NOT NULL;

-- CreateTable — one row per platform-level setting.
--
-- Board 2d, criterion 15: the Ramadan dates come from a platform setting, never
-- from seller input. They were already platform-level as a compiled constant,
-- which met the second half and not the first: a lunar calendar that shifts
-- every year should not need a deploy to correct.
CREATE TABLE IF NOT EXISTS "platform_setting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by_id" UUID,

  CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey — who last wrote it. Nullable, because the seed writes these
-- rows before any user exists; a staff write owes an audit row besides.
DO $$ BEGIN
  ALTER TABLE "platform_setting" ADD CONSTRAINT "platform_setting_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The calendar itself, so a database that is never reseeded still has one.
--
-- The same astronomical estimates the compiled fallback carries, per Hijri year
-- as Gregorian dates. Right to within a day at each end, which is close enough
-- to switch a supplier's hours over automatically and not close enough to
-- publish as fact — the surfaces say "about" for that reason.
INSERT INTO "platform_setting" ("key", "value", "updated_at")
VALUES (
  'ramadan_dates',
  '{"2026":{"from":"2026-02-17","to":"2026-03-19"},"2027":{"from":"2027-02-07","to":"2027-03-08"},"2028":{"from":"2028-01-27","to":"2028-02-25"},"2029":{"from":"2029-01-15","to":"2029-02-13"},"2030":{"from":"2030-01-05","to":"2030-02-03"},"2031":{"from":"2031-12-15","to":"2032-01-13"}}'::jsonb,
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
