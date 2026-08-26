-- Handoff 4, step 5. Board 4g: revenue and MRR movement.
--
-- The subscription table holds the plan an account is on now, not the one it
-- left, so new / expansion / contraction / churn cannot be derived from it. A
-- waterfall computed from current state is a fabricated metric, and this
-- codebase has deleted several already. Movement is an event instead, written
-- by the four places that change what an account pays: a signup, a plan change,
-- a cancellation reaching its end date, and the dunning drop.
--
-- MRR at any date is the running sum of `delta_fils`, and it must equal the
-- live subscription table. `tests/integration/revenue.test.ts` asserts it.

CREATE TYPE "mrr_movement_kind" AS ENUM (
  'new_business',
  'expansion',
  'contraction',
  'churn',
  'reactivation'
);

CREATE TABLE "mrr_movement" (
  "id"             TEXT NOT NULL,
  "business_id"    TEXT NOT NULL,
  "kind"           "mrr_movement_kind" NOT NULL,
  "from_plan_id"   TEXT,
  "to_plan_id"     TEXT,
  -- Signed. Negative for contraction and churn.
  "delta_fils"     INTEGER NOT NULL,
  -- What the account pays a month afterwards. Redundant with the running sum
  -- and kept anyway: reconciling a ledger against itself is the only way to
  -- find the row that is wrong.
  "mrr_after_fils" INTEGER NOT NULL,
  "occurred_at"    TIMESTAMP(3) NOT NULL,
  "note"           TEXT,

  CONSTRAINT "mrr_movement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mrr_movement"
  ADD CONSTRAINT "mrr_movement_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nobody pays a negative amount a month.
ALTER TABLE "mrr_movement"
  ADD CONSTRAINT "mrr_movement_after_is_not_negative"
  CHECK ("mrr_after_fils" >= 0);

-- The kind and the sign have to agree, or the waterfall shows growth in the
-- churn column. Expansion is up, contraction and churn are down, and a movement
-- that moved nothing is not a movement.
ALTER TABLE "mrr_movement"
  ADD CONSTRAINT "mrr_movement_sign_matches_kind"
  CHECK (
    ("kind" IN ('new_business', 'expansion', 'reactivation') AND "delta_fils" > 0)
    OR ("kind" IN ('contraction', 'churn') AND "delta_fils" < 0)
  );

-- Churn is to nothing. Anything else that goes down is a contraction.
ALTER TABLE "mrr_movement"
  ADD CONSTRAINT "mrr_movement_churn_is_to_zero"
  CHECK (("kind" = 'churn') = ("mrr_after_fils" = 0));

CREATE INDEX IF NOT EXISTS "mrr_movement_occurred_idx" ON "mrr_movement" ("occurred_at");
CREATE INDEX IF NOT EXISTS "mrr_movement_business_idx" ON "mrr_movement" ("business_id", "occurred_at");
