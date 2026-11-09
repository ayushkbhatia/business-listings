-- Task T6.4 — when the recipient read it.
--
-- Purely **additive**: one nullable column, no constraint, no data. By
-- `docs/deployments.md` § Ordering that means it applies *before* the merge
-- that reads it, and nothing on `main` reads it until then.
--
-- Nullable, and null means unread — which is what a bell counts. On the in-app
-- channel the delivery row **is** the notification, so without this column
-- board 7g could draw a list and never a count: every notice unread forever,
-- and a bell that always says nine is a bell nobody looks at.
--
-- No default and no backfill. Every row that exists today was written before
-- anything could be read, and `CURRENT_TIMESTAMP` on them would claim a
-- thousand notices were seen at the moment of a migration — a number the bell
-- would then be right to trust and wrong to show.
--
-- The one index a bell needs is the unread count per recipient, and it is
-- partial: a read notice is never counted, so it does not belong in the index.
ALTER TABLE "notification_delivery"
  ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "notification_delivery_unread_idx"
  ON "notification_delivery" ("recipient_user_id", "created_at" DESC)
  WHERE "read_at" IS NULL AND "status" = 'sent';
