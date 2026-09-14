-- Board 12d — the ops CRM: a task per demand signal, and what each call did.
--
-- Additive. Nothing on `main` reads the new tables or the new columns, and the
-- enum values are added without being used here, so this applies ahead of the
-- merge that writes them (docs/deployments.md § Ordering).

-- ── 1 · The call outcomes the board logs ────────────────────────────────────
--
-- `reached` and `converted` stay for the rows already written; the log strip
-- offers the board's six chips and `no_answer`, and nothing writes the two old
-- values again. `ADD VALUE IF NOT EXISTS` is safe inside a transaction on
-- Postgres 12+, provided the migration does not use the value, and it does not.

ALTER TYPE "call_outcome_kind" ADD VALUE IF NOT EXISTS 'interested';
ALTER TYPE "call_outcome_kind" ADD VALUE IF NOT EXISTS 'closed_down';
ALTER TYPE "call_outcome_kind" ADD VALUE IF NOT EXISTS 'claim_link_sent';

-- ── 2 · Tasks ───────────────────────────────────────────────────────────────
--
-- Every task originates in a signal (B1). `signal` and `signal_ref` are
-- required and the row has no free-text reason: the WHY THEM cell is rendered
-- from the signal and its measured value. `demand_score` is recomputed on every
-- derivation run (B2), and there is no priority column anyone could type into.

DO $$ BEGIN
  CREATE TYPE "crm_signal" AS ENUM ('held_page', 'zero_result', 'unclaimed_demand', 'cap_reached', 'churn_risk');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm_task_state" AS ENUM ('queued', 'called', 'callback', 'unreachable', 'won', 'lost', 'parked', 'cleared');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "crm_task" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "signal" "crm_signal" NOT NULL,
    "signal_ref" TEXT NOT NULL,
    "signal_value" INTEGER NOT NULL,
    "signal_facts" JSONB NOT NULL DEFAULT '{}',
    "demand_score" INTEGER NOT NULL,
    "state" "crm_task_state" NOT NULL DEFAULT 'queued',
    "assigned_to_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "call_back_at" TIMESTAMP(3),
    "cooling_until" TIMESTAMP(3),
    "last_touch_at" TIMESTAMP(3),
    "last_outcome" "call_outcome_kind",
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "derived_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_task_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The shape a derived row must have, and the pairs that move together.
DO $$ BEGIN
  ALTER TABLE "crm_task" ADD CONSTRAINT "crm_task_shape"
    CHECK (char_length(btrim("signal_ref")) > 0
       AND "signal_value" >= 0
       AND "demand_score" >= 0
       AND (("assigned_to_id" IS NULL) = ("assigned_at" IS NULL))
       AND (("state" = 'callback') = ("call_back_at" IS NOT NULL))
       AND (("state" IN ('won', 'lost', 'parked', 'cleared')) = ("closed_at" IS NOT NULL))
       AND (("closed_at" IS NULL) = ("close_reason" IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One open task per business. `assigned_to_id` on it is the lock: two ops
-- leads cannot both be working the same account.
CREATE UNIQUE INDEX IF NOT EXISTS "crm_task_one_open_per_business" ON "crm_task"("business_id") WHERE "closed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "crm_task_assigned_to_id_state_demand_score_idx" ON "crm_task"("assigned_to_id", "state", "demand_score");
CREATE INDEX IF NOT EXISTS "crm_task_state_demand_score_idx" ON "crm_task"("state", "demand_score");
CREATE INDEX IF NOT EXISTS "crm_task_business_id_closed_at_idx" ON "crm_task"("business_id", "closed_at");
CREATE INDEX IF NOT EXISTS "crm_task_closed_at_id_idx" ON "crm_task"("closed_at", "id");

-- ── 3 · The call log, tied to the task and the script ───────────────────────

ALTER TABLE "call_outcome" ADD COLUMN IF NOT EXISTS "task_id" TEXT;
ALTER TABLE "call_outcome" ADD COLUMN IF NOT EXISTS "script_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "call_outcome" ADD CONSTRAINT "call_outcome_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "crm_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "call_outcome_task_id_idx" ON "call_outcome"("task_id");
CREATE INDEX IF NOT EXISTS "call_outcome_created_at_id_idx" ON "call_outcome"("created_at", "id");

-- ── 4 · A number revealed to staff (B9) ─────────────────────────────────────
--
-- Not `contact_reveal`, which counts buyers revealing a seller's number and is
-- what a seller is shown as delivered value. A staff member dialling a lead is
-- not a buyer, and mixing the two would inflate the seller's figure.

CREATE TABLE IF NOT EXISTS "crm_contact_reveal" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "location_id" TEXT,
    "staff_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contact_reveal_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "crm_contact_reveal" ADD CONSTRAINT "crm_contact_reveal_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "crm_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_contact_reveal" ADD CONSTRAINT "crm_contact_reveal_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_contact_reveal" ADD CONSTRAINT "crm_contact_reveal_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_contact_reveal" ADD CONSTRAINT "crm_contact_reveal_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "crm_contact_reveal_staff_id_created_at_idx" ON "crm_contact_reveal"("staff_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_contact_reveal_task_id_idx" ON "crm_contact_reveal"("task_id");

-- ── 5 · When the signals were last derived ──────────────────────────────────
--
-- The empty queue states when the list was last built and when it builds next,
-- which a queue with no rows cannot say about itself.

CREATE TABLE IF NOT EXISTS "crm_sync_run" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "derived" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "won" INTEGER NOT NULL,
    "cleared" INTEGER NOT NULL,
    "triggered_by_id" UUID,

    CONSTRAINT "crm_sync_run_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "crm_sync_run" ADD CONSTRAINT "crm_sync_run_triggered_by_id_fkey"
    FOREIGN KEY ("triggered_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "crm_sync_run_finished_at_id_idx" ON "crm_sync_run"("finished_at", "id");
