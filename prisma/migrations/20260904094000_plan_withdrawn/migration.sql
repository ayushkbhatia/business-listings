-- Board 1l, criterion 12: a plan withdrawn from sale stops appearing on
-- /pricing while everybody already on it keeps it. The row is never deleted —
-- Business.plan_id and subscription.plan_id still resolve, and the entitlement
-- snapshot still grandfathers the numbers — so withdrawal is one nullable date
-- that only the surfaces which sell a plan read.
--
-- Additive and idempotent: the column is nullable with no default, so an
-- existing row is purchasable until somebody decides otherwise.
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "withdrawn_at" TIMESTAMP(3);
