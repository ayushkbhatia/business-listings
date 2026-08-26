-- The dunning constraint, loosened by exactly one state.
--
-- `20260827020000_dunning` wrote it as a biconditional:
--
--     CHECK (("dunning_stage" = 'none') = ("past_due_since" IS NULL))
--
-- which forbids the one state the intake side needs. A payment fails at 02:14
-- and the job runs at 03:00; between those two the row is `past_due` with a
-- real failure date and a stage of `none`, because nothing has happened to the
-- seller yet. Under the biconditional the webhook could not record the date it
-- actually failed, so the whole fourteen-day sequence would be measured from
-- whenever the cron next happened to fire.
--
-- The half worth keeping is the other one: a stage past `none` is meaningless
-- without a date, because every step is measured from it.

ALTER TABLE "subscription" DROP CONSTRAINT "subscription_dunning_has_a_start";

ALTER TABLE "subscription"
  ADD CONSTRAINT "subscription_dunning_has_a_start"
  CHECK ("dunning_stage" = 'none' OR "past_due_since" IS NOT NULL);
