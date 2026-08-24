-- Handoff 2, step 6. The constraint schema.prisma has been promising.
--
-- `Review.removalReason` carries the comment "Required when removedAt is set.
-- Enforced by a check constraint in the migration, not only by the service
-- layer." The constraint was never written. Criterion 9 asks that removal
-- without a reason throws, and a service-layer check is one forgotten call
-- away from a removal nobody can explain.
--
-- Paired, not merely non-null: a reason with no removal is as wrong as a
-- removal with no reason, and both mean somebody wrote half a change.
ALTER TABLE "review"
  ADD CONSTRAINT "review_removal_has_a_reason"
  CHECK (("removed_at" IS NULL) = ("removal_reason" IS NULL));

-- A seller reply is one reply. It cannot be edited after posting and it is
-- never seller-deletable, so the timestamp and the text arrive together.
ALTER TABLE "review"
  ADD CONSTRAINT "review_reply_has_a_timestamp"
  CHECK (("seller_reply" IS NULL) = ("seller_replied_at" IS NULL));
