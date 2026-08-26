-- Handoff 4, step 5. Dunning.
--
-- Criterion 10: the D0/D3/D7/D14 sequence, and it "never deletes a listing or
-- removes a badge". The second half is the load-bearing one and it is a
-- negative — the kind that passes by accident — so the stage lives in a column
-- and the drop at D14 is a plan change and nothing else.
--
-- "A failed card is usually an expired card, not a decision to leave."

CREATE TYPE "dunning_stage" AS ENUM ('none', 'retry', 'emailed', 'messaged', 'final', 'dropped');

ALTER TABLE "subscription"
  ADD COLUMN "dunning_stage" "dunning_stage" NOT NULL DEFAULT 'none',
  -- When the payment first failed. Every step is measured from here rather than
  -- from the previous step, so a missed run does not push the whole sequence
  -- back and leave somebody in dunning for a month.
  ADD COLUMN "past_due_since" TIMESTAMP(3),
  ADD COLUMN "dunning_advanced_at" TIMESTAMP(3);

-- A stage past 'none' means there is a date it started from.
ALTER TABLE "subscription"
  ADD CONSTRAINT "subscription_dunning_has_a_start"
  CHECK (("dunning_stage" = 'none') = ("past_due_since" IS NULL));

CREATE INDEX IF NOT EXISTS "subscription_dunning_idx"
  ON "subscription" ("dunning_stage", "past_due_since")
  WHERE "dunning_stage" <> 'none';

-- One row per attempt to take the money. Kept because "the card failed four
-- times" and "the card failed once and we never tried again" are different
-- conversations to have with a seller.
CREATE TABLE "payment_attempt" (
  "id"              TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "amount_fils"     INTEGER NOT NULL,
  "succeeded"       BOOLEAN NOT NULL,
  -- What the provider said. Free text: every gateway words it differently and
  -- the seller-facing message is ours, not theirs.
  "provider_message" TEXT,
  "attempted_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_attempt"
  ADD CONSTRAINT "payment_attempt_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_attempt"
  ADD CONSTRAINT "payment_attempt_amount_is_positive"
  CHECK ("amount_fils" > 0);

CREATE INDEX IF NOT EXISTS "payment_attempt_subscription_idx"
  ON "payment_attempt" ("subscription_id", "attempted_at" DESC);
