-- Recurring renewals, and the term a subscription is paid on.
--
-- `renews_at` has existed since the init migration and nothing has ever advanced
-- it: `changePlan` sets it once and the seed sets it, and no job moves it. So
-- the recurring cycle is being built now, and the billing term is a property of
-- that cycle rather than a feature added to a working one.
--
-- Every statement is idempotent. docs/database.md records the incident that made
-- this a rule: a hand-written migration whose statements were not guarded looked
-- like drift to `migrate dev`, which generated a second migration dropping them.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_term') THEN
    CREATE TYPE "billing_term" AS ENUM ('monthly', 'annual');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "term" "billing_term" NOT NULL DEFAULT 'monthly';
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "period_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "anchor_day" INTEGER NOT NULL DEFAULT 1;

-- Backfill from what the row already knows.
--
-- Every existing subscription is monthly, and its current period is the one it
-- started in — there has never been a renewal to move it. The anchor is the day
-- of the month it began on, which is the day every future period should land on.
UPDATE "subscription" SET "period_started_at" = "started_at" WHERE "period_started_at" > "started_at";
UPDATE "subscription" SET "anchor_day" = EXTRACT(DAY FROM "started_at")::INTEGER WHERE "anchor_day" = 1;

-- An anchor is a day of a month.
--
-- 31 is legal and is the interesting case: a subscription anchored on the 31st
-- renews on the 28th of February and must return to the 31st of March. Clamping
-- happens on read, in `advance()`; the column keeps the day that was asked for.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_anchor_day_is_a_day'
  ) THEN
    ALTER TABLE "subscription" ADD CONSTRAINT "subscription_anchor_day_is_a_day"
      CHECK ("anchor_day" BETWEEN 1 AND 31);
  END IF;
END $$;
