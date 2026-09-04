-- What a year costs, as a count of months rather than a second price.
--
-- Board 1l's pricing page has shown an annual figure since it shipped, derived
-- from a constant and labelled "not switched on yet" because nothing could
-- charge it. This is the column that makes it real.
--
-- A count, not a price: `plan` has one price column and a second would be a
-- second number to keep in step. Null means the plan is monthly-only, which is
-- the honest value for Free.
--
-- Its own migration rather than a line in the term migration, because the two
-- answer different questions — one is how a subscription is paid, this is what
-- we are willing to sell.
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "annual_months_charged" INTEGER;

-- Ten months for twelve, on the two paid tiers. Free stays null.
UPDATE "plan" SET "annual_months_charged" = 10
  WHERE "monthly_price_aed" > 0 AND "annual_months_charged" IS NULL;

-- A year is more than nothing and less than a year.
--
-- Zero would make an annual plan free and twelve or more would make it dearer
-- than paying monthly, and both are commercial mistakes a constraint can catch
-- before a seller does.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plan_annual_is_a_discount'
  ) THEN
    ALTER TABLE "plan" ADD CONSTRAINT "plan_annual_is_a_discount"
      CHECK ("annual_months_charged" IS NULL OR "annual_months_charged" BETWEEN 1 AND 11);
  END IF;
END $$;
