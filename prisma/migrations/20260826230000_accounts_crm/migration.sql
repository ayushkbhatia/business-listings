-- Handoff 4, step 4. Accounts, the call list, and view-as.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. View-as
--
-- Criterion 8: read-only, expires at 30 minutes, writes an audit row naming the
-- ticket.
--
-- A row rather than a cookie claim, because the cap has to be a fact the server
-- checks rather than a number the browser was told. A session that expires only
-- when the tab is closed is not capped.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "view_as_session" (
  "id"          TEXT NOT NULL,
  "staff_id"    UUID NOT NULL,
  "business_id" TEXT NOT NULL,
  -- The ticket this is for. NOT NULL: looking through a seller's eyes without a
  -- reason to is the thing §07 calls a privacy event, and "which ticket" is the
  -- reason.
  "ticket_ref"  TEXT NOT NULL,
  "started_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "ended_at"    TIMESTAMP(3),

  CONSTRAINT "view_as_session_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "view_as_session"
  ADD CONSTRAINT "view_as_session_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "view_as_session"
  ADD CONSTRAINT "view_as_session_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "view_as_session"
  ADD CONSTRAINT "view_as_session_expires_after_it_starts"
  CHECK ("expires_at" > "started_at");

-- One live session per staff member. Two at once would mean a support call
-- where nobody can say whose account is on screen.
CREATE UNIQUE INDEX IF NOT EXISTS "view_as_session_one_live_per_staff"
  ON "view_as_session" ("staff_id") WHERE "ended_at" IS NULL;

CREATE INDEX IF NOT EXISTS "view_as_session_business_idx"
  ON "view_as_session" ("business_id", "started_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Call outcomes
--
-- The call *list* is deliberately not a table. Board 12d: it builds itself from
-- demand signals, and "no manual entry" is a property you get by having nowhere
-- to type — so the list is a query over `ZeroResultQuery`, `MissedEnquiry` and
-- the plan state, and only what happened on the call is written down.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "call_outcome_kind" AS ENUM (
  'reached',
  'no_answer',
  'wrong_number',
  'not_interested',
  'call_back',
  'converted'
);

CREATE TABLE "call_outcome" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "staff_id"    UUID NOT NULL,
  "kind"        "call_outcome_kind" NOT NULL,
  -- Which signal put them on the list, recorded so the argument that worked can
  -- be told from the one that did not.
  "signal"      TEXT NOT NULL,
  "note"        TEXT,
  "call_back_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_outcome_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "call_outcome"
  ADD CONSTRAINT "call_outcome_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_outcome"
  ADD CONSTRAINT "call_outcome_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A call-back date belongs to a call-back and to nothing else.
ALTER TABLE "call_outcome"
  ADD CONSTRAINT "call_outcome_call_back_has_a_date"
  CHECK (("kind" = 'call_back') = ("call_back_at" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "call_outcome_business_idx"
  ON "call_outcome" ("business_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "call_outcome_due_idx"
  ON "call_outcome" ("call_back_at") WHERE "call_back_at" IS NOT NULL;
