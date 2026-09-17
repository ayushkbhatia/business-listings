-- Board `4h` — one queue for six kinds of complaint, with an owner, an SLA and
-- a taxonomy that reconciles with its own header.
--
-- 1. `report_outcome` gains `duplicate` (`B6`). Three people reporting one wrong
--    phone number is one work item and three records; closing two of them as
--    `no_action` would say the platform looked and found nothing.
--
-- 2. `report_detector` is new (`B11`): which detector filed a report, or NULL
--    for a person. The inference this replaces — "a report nobody filed is one
--    the platform filed" — stops being true the moment a signed-out visitor can
--    file one.
--
-- 3. `supplier_report` gains the evidence line, the detector, an owner, an
--    escalation, a duplicate pointer and the seat that decided. Every one of
--    them is NULL on the rows already there, and the deployed code selects none
--    of them.
--
-- 4. `review_dispute` gains the same three owner columns. Board `11c` `B5` asked
--    for "a queue and an SLA owner"; the queue shipped and the owner did not.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- Nothing is dropped, nothing is renamed, and no column becomes NOT NULL. The
-- deployed code keeps reading `supplier_report` and `review_dispute` exactly as
-- it does today; a report filed by the previous deployment carries NULL in every
-- new column, which is what an unassigned, unescalated, person-filed report is.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

-- ── 1 · the fourth outcome ──────────────────────────────────────────────────

ALTER TYPE "report_outcome" ADD VALUE IF NOT EXISTS 'duplicate';

-- ── 2 · the detectors ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_detector') THEN
    CREATE TYPE "report_detector" AS ENUM ('off_platform_message', 'shared_phone', 'licence_long_expired');
  END IF;
END $$;

-- ── 3 · the report row ──────────────────────────────────────────────────────

ALTER TABLE "supplier_report"
  ADD COLUMN IF NOT EXISTS "evidence"          TEXT,
  ADD COLUMN IF NOT EXISTS "detector"          "report_detector",
  ADD COLUMN IF NOT EXISTS "assignee_id"       UUID,
  ADD COLUMN IF NOT EXISTS "assigned_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assigned_by_id"    UUID,
  ADD COLUMN IF NOT EXISTS "escalated_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "escalated_by_id"   UUID,
  ADD COLUMN IF NOT EXISTS "escalation_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicate_of_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "resolved_by_id"    UUID;

DO $$
BEGIN
  -- An escalation carries its reason, like every other staff state change here.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_escalation_reasoned') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_escalation_reasoned"
      CHECK (
        ("escalated_at" IS NULL AND "escalation_reason" IS NULL)
        OR ("escalated_at" IS NOT NULL AND char_length(btrim("escalation_reason")) >= 4)
      );
  END IF;

  -- A duplicate points at what it duplicates, and nothing else does.
  --
  -- Compared as text on purpose. `duplicate` is added to the enum by this same
  -- migration, and Postgres refuses to *use* a new enum value in the
  -- transaction that added it — `prisma migrate deploy` runs each file in one.
  -- A cast reads the label rather than the value and is settled at check time.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_duplicate_points_somewhere') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_duplicate_points_somewhere"
      CHECK (
        ("duplicate_of_id" IS NULL AND "outcome"::text IS DISTINCT FROM 'duplicate')
        OR ("duplicate_of_id" IS NOT NULL AND "outcome"::text = 'duplicate')
      );
  END IF;

  -- A report never duplicates itself.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_duplicate_is_another_row') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_duplicate_is_another_row"
      CHECK ("duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_assignee_id_fkey') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_assignee_id_fkey"
      FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_assigned_by_id_fkey') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_assigned_by_id_fkey"
      FOREIGN KEY ("assigned_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_escalated_by_id_fkey') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_escalated_by_id_fkey"
      FOREIGN KEY ("escalated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_resolved_by_id_fkey') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_resolved_by_id_fkey"
      FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_duplicate_of_id_fkey') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_duplicate_of_id_fkey"
      -- CASCADE, not SET NULL. A duplicate's outcome is meaningless without the
      -- decision it points at, and the check above refuses the null — so SET
      -- NULL would have made deleting a decided report impossible rather than
      -- tidy. Both rows belong to one business and go together with it.
      FOREIGN KEY ("duplicate_of_id") REFERENCES "supplier_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "supplier_report_queue_idx"        ON "supplier_report" ("outcome", "created_at");
CREATE INDEX IF NOT EXISTS "supplier_report_duplicate_of_idx" ON "supplier_report" ("duplicate_of_id");
CREATE INDEX IF NOT EXISTS "supplier_report_collapse_idx"     ON "supplier_report" ("subject_business_id", "kind", "subject_field", "outcome");
CREATE INDEX IF NOT EXISTS "supplier_report_assignee_idx"     ON "supplier_report" ("assignee_id", "outcome");

-- ── 4 · the dispute row gains an owner ──────────────────────────────────────

ALTER TABLE "review_dispute"
  ADD COLUMN IF NOT EXISTS "assignee_id"    UUID,
  ADD COLUMN IF NOT EXISTS "assigned_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assigned_by_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_dispute_assignee_id_fkey') THEN
    ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_assignee_id_fkey"
      FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_dispute_assigned_by_id_fkey') THEN
    ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_assigned_by_id_fkey"
      FOREIGN KEY ("assigned_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "review_dispute_assignee_idx" ON "review_dispute" ("assignee_id", "outcome");
