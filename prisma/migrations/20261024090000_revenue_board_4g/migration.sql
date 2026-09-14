-- Board 4g — subscriptions and revenue.
--
-- Additive. Nothing on `main` reads either column, and both are nullable, so the
-- writers on `main` keep inserting while this is applied ahead of the merge
-- that fills them (docs/deployments.md § Ordering).

-- ── 1 · Why a movement happened ────────────────────────────────────────────
--
-- `kind` says which way the money moved; it cannot say why. A churn row is a
-- cancellation reaching its date or a card failing for fourteen days, and the
-- board reports those as two lines — a lapse after failed payments is not a
-- decision to leave and has no reason to count (B8). An expansion is an upgrade
-- or a switch back to monthly billing, and a term switch is not a customer
-- choosing a bigger plan. Written by the caller that knows, in the same
-- transaction as the movement.

DO $$ BEGIN
  CREATE TYPE "mrr_movement_cause" AS ENUM ('plan_change', 'term_change', 'cancellation', 'dunning_drop');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "mrr_movement" ADD COLUMN IF NOT EXISTS "cause" "mrr_movement_cause";

-- The rows written before today, by what their writer can be recognised by.
-- A term switch is the only movement whose plan does not change; the two churn
-- writers have always stamped these notes.
UPDATE "mrr_movement"
SET "cause" = CASE
  WHEN "from_plan_id" IS NOT NULL AND "from_plan_id" = "to_plan_id" THEN 'term_change'::"mrr_movement_cause"
  WHEN "kind" = 'churn' AND "note" LIKE 'Dunning drop%' THEN 'dunning_drop'::"mrr_movement_cause"
  WHEN "kind" = 'churn' AND "note" LIKE 'Cancellation%' THEN 'cancellation'::"mrr_movement_cause"
  ELSE 'plan_change'::"mrr_movement_cause"
END
WHERE "cause" IS NULL;

-- A term switch keeps the plan, and nothing else does.
DO $$ BEGIN
  ALTER TABLE "mrr_movement" ADD CONSTRAINT "mrr_movement_term_change_keeps_plan"
    CHECK ("cause" IS DISTINCT FROM 'term_change' OR "from_plan_id" IS NOT DISTINCT FROM "to_plan_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2 · The request a movement carried out ──────────────────────────────────
--
-- A cancellation's reason lives on its `subscription_change` row, and the churn
-- it causes is written months later by a sweep. Joining them on "same business,
-- same instant" is a coincidence of two `now`s; this is the pointer. B5 counts
-- reasons through it, so the reasons sum to the cancellations line by
-- construction rather than by two queries that happen to agree.

ALTER TABLE "mrr_movement" ADD COLUMN IF NOT EXISTS "subscription_change_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "mrr_movement" ADD CONSTRAINT "mrr_movement_subscription_change_id_fkey"
    FOREIGN KEY ("subscription_change_id") REFERENCES "subscription_change"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "mrr_movement_subscription_change_idx" ON "mrr_movement"("subscription_change_id");

-- Rows already written: the applier stamps `applied_at` and `occurred_at` from
-- one `now`, so an exact match on the business and the instant is the change
-- that movement applied.
UPDATE "mrr_movement" AS m
SET "subscription_change_id" = c."id"
FROM "subscription_change" AS c
WHERE m."subscription_change_id" IS NULL
  AND c."business_id" = m."business_id"
  AND c."applied_at" = m."occurred_at"
  AND (
    (m."cause" = 'cancellation' AND c."kind" = 'cancellation')
    OR (m."cause" = 'plan_change' AND c."kind" = 'plan_change')
  );
