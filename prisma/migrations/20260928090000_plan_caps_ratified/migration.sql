-- D1, decided 9 Sep 2026: the seven Free-tier numbers are ratified, and the
-- `plan` table is the only place any of them may live.
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- No migration has ever created or set a plan row. `rg 'INSERT INTO "plan"'
-- prisma/migrations/` returned nothing before this file: the init migration
-- created the columns empty and defaultless, and the only writer was
-- `prisma/seed.mts`, which truncates 46 tables and is refused against any
-- non-loopback host by `lib/db/target.ts`.
--
-- So production's plan rows are whatever somebody typed once, and three later
-- patches moved them further from the seed — `team_seats` set to 2 for Free and
-- never reversed, `photo_limit` set to 30 only where it was still 5, and
-- `storage_mb` added with no backfill. The live Free tier gives 2 seats and
-- unlimited storage. Nobody chose that.
--
-- IDEMPOTENT, AND SAFE TO RUN TWICE
--
-- `ON CONFLICT DO UPDATE` rather than a bare UPDATE, so a database that somehow
-- has no plan row gets one instead of silently staying empty, and a second run
-- is a no-op rather than an error.
--
-- STORAGE IS A REDUCTION ON THE TWO PAID PLANS, AND IT IS DELIBERATE
--
-- Production has `storage_mb` NULL on Basic and Pro, which reads as unlimited.
-- Free is already correct and is unchanged by this file.
--
-- 300 MB and 500 MB, decided by the owner on 9 Sep 2026. All eight paying
-- subscriptions fall back to the live plan for storage — none of their
-- entitlement snapshots carries a `storageMb` key — so this caps accounts that
-- currently have no cap. Every one of them is at 0 bytes with no media rows, so
-- nothing is over the new limit and no upload is refused by it today.
--
-- WHAT THIS DOES NOT TOUCH
--
-- `entitlement_snapshot` on `subscription`. A seller who signed up on different
-- numbers keeps them: that is what the snapshot is for, `effectiveCaps` prefers
-- it over the live row, and rewriting history to match a decision taken
-- afterwards is the one thing it exists not to do.

ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "public_photo_limit" INTEGER;

INSERT INTO "plan" (
  "id", "name", "monthly_price_aed", "enquiries_per_month", "product_limit",
  "location_limit", "photo_limit", "public_photo_limit", "storage_mb",
  "category_limit", "team_seats", "ranking_multiplier", "custom_domain",
  "analytics", "csv_import", "sponsored_eligible", "sort_order",
  "annual_months_charged"
) VALUES
  ('free',  'Free',    0, 3,    10,  1,  30,  3,    50, 1, 1,  1.00, false, false, false, false, 0, NULL),
  ('basic', 'Basic', 349, 40,  150,  3,  40,  NULL, 300, 3, 3,  1.15, false, true,  true,  false, 1, 10),
  ('pro',   'Pro',   899, NULL, NULL, 10, 200, NULL, 500, NULL, 10, 1.35, true,  true,  true,  true,  2, 10)
ON CONFLICT ("id") DO UPDATE SET
  "name"                  = EXCLUDED."name",
  "monthly_price_aed"     = EXCLUDED."monthly_price_aed",
  "enquiries_per_month"   = EXCLUDED."enquiries_per_month",
  "product_limit"         = EXCLUDED."product_limit",
  "location_limit"        = EXCLUDED."location_limit",
  "photo_limit"           = EXCLUDED."photo_limit",
  "public_photo_limit"    = EXCLUDED."public_photo_limit",
  "storage_mb"            = EXCLUDED."storage_mb",
  "category_limit"        = EXCLUDED."category_limit",
  "team_seats"            = EXCLUDED."team_seats",
  "ranking_multiplier"    = EXCLUDED."ranking_multiplier",
  "custom_domain"         = EXCLUDED."custom_domain",
  "analytics"             = EXCLUDED."analytics",
  "csv_import"            = EXCLUDED."csv_import",
  "sponsored_eligible"    = EXCLUDED."sponsored_eligible",
  "sort_order"            = EXCLUDED."sort_order",
  "annual_months_charged" = EXCLUDED."annual_months_charged";
