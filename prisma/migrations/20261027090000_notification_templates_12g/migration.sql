-- Board `12g` — notification templates: a services twin per body, Meta's answer
-- recorded against the version it was about, and volume that is a query.
--
-- 1. `template_kind` and `notification_template.kind`. Two lines per event and
--    channel — the primary body (`goods` or `neutral`) and its `services` twin —
--    so the unique key gains the column. Not nullable: `@@unique` over a
--    nullable column treats every null as distinct, and two neutral v3s of one
--    template would both be accepted.
-- 2. `rejected` and `superseded` on `template_approval`, with `meta_note`,
--    `submitted_at` and `decided_at`: a WhatsApp version Meta refused says why,
--    and a v5 saved while v4 waits takes its place in the queue (Q1).
-- 3. `created_by_id`: who wrote a version. Null for rows written before anybody
--    had edited one.
-- 4. `notification_delivery.trade_kind` and `.test`: which trade a message was
--    about, so goods wording reaching a services brief is counted rather than
--    asserted; and whether it was a staff test send, which no volume includes.
-- 5. An index on `(template_id, created_at)` — `SENT 30D` is a query (B1).
--
-- Existing rows are classified by event. A body that speaks in quotes, lines
-- and quantities is `goods` and owes a twin; one about a licence, a renewal or a
-- review is `neutral` and never does. Only rows nobody on staff wrote are
-- touched, so a second run cannot undo a decision made on the console.
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- The code on `main` writes neither new column and reads neither new status; the
-- old unique key is replaced by a strictly wider one, which every row that
-- satisfied the old key also satisfies. Idempotent: applied through the Supabase
-- MCP and then recorded, a second run is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_kind') THEN
    CREATE TYPE "template_kind" AS ENUM ('neutral', 'goods', 'services');
  END IF;
END
$$;

ALTER TYPE "template_approval" ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE "template_approval" ADD VALUE IF NOT EXISTS 'superseded';

ALTER TABLE "notification_template"
  ADD COLUMN IF NOT EXISTS "kind" "template_kind" NOT NULL DEFAULT 'goods',
  ADD COLUMN IF NOT EXISTS "meta_note" TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_by_id" UUID;

UPDATE "notification_template"
SET "kind" = 'neutral'
WHERE "created_by_id" IS NULL
  AND "kind" = 'goods'
  AND "event" IN (
    'subscription_renewed',
    'message_received',
    'enquiry_escalated',
    'review_posted',
    'review_dispute_decided',
    'document_expiring',
    'setup_nudge',
    'ramadan_dates_moved',
    'product_alert_matched'
  );

DROP INDEX IF EXISTS "notification_template_event_channel_locale_version_key";
CREATE UNIQUE INDEX IF NOT EXISTS "notification_template_event_channel_locale_kind_version_key"
  ON "notification_template" ("event", "channel", "locale", "kind", "version");

ALTER TABLE "notification_delivery"
  ADD COLUMN IF NOT EXISTS "trade_kind" "trade_kind",
  ADD COLUMN IF NOT EXISTS "test" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "notification_delivery_template_created_idx"
  ON "notification_delivery" ("template_id", "created_at");
