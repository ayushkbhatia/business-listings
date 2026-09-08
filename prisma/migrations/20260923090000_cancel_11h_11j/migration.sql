-- Boards 11h + 11j — cancel subscription, in two steps.
--
-- Additive. Every column is nullable or has a default, and the backfill only
-- writes rows for subscriptions that are already cancelling. Safe to apply
-- before the code that reads it — docs/deployments.md § Ordering.
--
-- ## Why the cancellation lands on `subscription_change`
--
-- A cancellation is a scheduled move to Free: same effective date, same
-- withdraw-before-then, and the same "which ten products stay live" choice the
-- downgrade already carries in `keep_product_ids`. Board 11h's spec is explicit
-- that it reuses that mechanism rather than building a second picker, and the
-- alternative — keep lists on `subscription`, a reason somewhere else — is two
-- half-mechanisms that drift the first time one is written without the other.
--
-- `subscription.cancelled_at` / `ends_at` stay exactly as they are. They are
-- read by the renewal job, by dunning and by the revenue waterfall, and this
-- migration does not move that; the change row carries the *choice* and the
-- *reason*, which had nowhere to live at all.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. What a pending row is
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "subscription_change_kind" AS ENUM ('plan_change', 'cancellation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The six reasons on board 11j, in the order they are asked. `business_closing`
-- is the fork to 11i rather than a cancellation, and is recorded either way.
DO $$ BEGIN
  CREATE TYPE "cancel_reason" AS ENUM (
    'too_expensive',
    'not_enough_enquiries',
    'poor_quality_enquiries',
    'another_platform',
    'business_closing',
    'something_else'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "subscription_change"
  ADD COLUMN IF NOT EXISTS "kind" "subscription_change_kind" NOT NULL DEFAULT 'plan_change',
  ADD COLUMN IF NOT EXISTS "cancel_reason" "cancel_reason",
  ADD COLUMN IF NOT EXISTS "cancel_note" TEXT,
  ADD COLUMN IF NOT EXISTS "requested_by_id" UUID;

DO $$ BEGIN
  ALTER TABLE "subscription_change"
    ADD CONSTRAINT "subscription_change_requested_by_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A plan change has no reason to record. Letting one carry a `cancel_reason`
-- would put rows into board 4g's churn report that are not churn.
ALTER TABLE "subscription_change"
  DROP CONSTRAINT IF EXISTS "subscription_change_reason_matches_kind";
ALTER TABLE "subscription_change"
  ADD CONSTRAINT "subscription_change_reason_matches_kind"
  CHECK (
    "kind" = 'cancellation'
    OR ("cancel_reason" IS NULL AND "cancel_note" IS NULL)
  );

-- `Something else` makes the box the only place the reason exists. A row with
-- that reason and nothing written is a churn signal carrying no signal.
ALTER TABLE "subscription_change"
  DROP CONSTRAINT IF EXISTS "subscription_change_other_needs_a_note";
ALTER TABLE "subscription_change"
  ADD CONSTRAINT "subscription_change_other_needs_a_note"
  CHECK (
    "cancel_reason" IS DISTINCT FROM 'something_else'
    OR ("cancel_note" IS NOT NULL AND btrim("cancel_note") <> '')
  );

-- The churn read: cancellations by reason over a window.
CREATE INDEX IF NOT EXISTS "subscription_change_kind_created_idx"
  ON "subscription_change" ("kind", "created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill — the cancellations that were already scheduled
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `applyEndedCancellations` now drives off these rows, so a subscription that
-- was cancelling before this migration needs one or its period end would arrive
-- and nothing would drop it. There is at most one pending row per business —
-- the partial unique index below has enforced that since 11f — so a business
-- with a pending *plan change* and a cancellation in flight has to lose one of
-- them. It loses the plan change: a seller who is leaving has not also asked to
-- be moved to Basic on the same date, and the downgrade was the earlier
-- intention.
--
-- Reason is left NULL. These sellers were never asked, and inventing
-- `something_else` for them would fill the one report this column exists for
-- with rows nobody wrote.

UPDATE "subscription_change" AS c
SET "withdrawn_at" = NOW()
FROM "subscription" AS s
WHERE c."business_id" = s."business_id"
  AND c."applied_at" IS NULL
  AND c."withdrawn_at" IS NULL
  AND c."kind" = 'plan_change'
  AND s."cancelled_at" IS NOT NULL
  AND s."ends_at" IS NOT NULL
  AND s."status" <> 'cancelled';

INSERT INTO "subscription_change" (
  "id", "business_id", "from_plan_id", "to_plan_id", "from_term", "to_term",
  "effective_at", "kind", "created_at"
)
SELECT
  -- cuid-shaped enough to sit beside the generated ones, and unique by row.
  'c' || substr(md5(s."id" || 'cancel-backfill'), 1, 24),
  s."business_id",
  s."plan_id",
  'free',
  s."term",
  s."term",
  s."ends_at",
  'cancellation',
  COALESCE(s."cancelled_at", NOW())
FROM "subscription" AS s
WHERE s."cancelled_at" IS NOT NULL
  AND s."ends_at" IS NOT NULL
  AND s."status" <> 'cancelled'
  AND EXISTS (SELECT 1 FROM "plan" WHERE "id" = 'free')
  AND NOT EXISTS (
    SELECT 1 FROM "subscription_change" AS c
    WHERE c."business_id" = s."business_id"
      AND c."applied_at" IS NULL
      AND c."withdrawn_at" IS NULL
  );
