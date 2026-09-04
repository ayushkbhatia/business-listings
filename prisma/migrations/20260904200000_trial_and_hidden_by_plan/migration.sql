-- Board 2e: the Pro trial, and the promise that a drop hides rather than deletes.

-- AlterTable — when the trial started, and when it ends.
--
-- `trial_started_at` is set once and never cleared: criterion 11 asks that a
-- seller who has used the trial sees no trial language again, and that is a
-- fact about the account rather than about the plan it is on today. The
-- subscription row is unique per business and is never deleted, so it keeps.
--
-- `trial_ends_at` is what the daily sweep reads. A trial takes no card, so
-- there is nothing to charge at the end of one and the account drops to Free.
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "trial_started_at" TIMESTAMP(3);
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3);

-- AlterTable — which products a plan drop hid.
--
-- "Your products and photos stay saved — hidden, not deleted" was a claim the
-- cancel summary made and nothing implemented. Hiding is `product.status =
-- 'draft'`, which every public surface already excludes; this column records
-- which ones the platform hid so an upgrade restores exactly those and not the
-- drafts the seller wrote themselves.
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "hidden_by_plan" JSONB;

-- CreateIndex — the sweep's own query: every trial that has run out.
--
-- Partial, because the rows that matter are a handful and the table is every
-- paying account. A full index here would be mostly nulls.
CREATE INDEX IF NOT EXISTS "subscription_trial_ends_at_idx"
  ON "subscription"("trial_ends_at")
  WHERE "trial_ends_at" IS NOT NULL;
