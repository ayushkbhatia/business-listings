-- Board 4b, board-level pass. The approval queue — every submission a person
-- asserts, the checks a machine already ran, and a bulk action bounded by them.
--
-- The queue reads four tables that already exist — `listing_change_request`,
-- `claim_submission`, `claim_conflict` and `document` — plus branches a seller
-- has published outside the emirate their licence covers. What none of them
-- could hold is the queue's own state: who a submission is assigned to, that a
-- document was asked for and when it came back, and a staff decision about a
-- branch. That lives in `queue_item`, one row per submission, written only
-- when there is something to say.
--
-- `allPassed` is not stored anywhere (B2). It is computed from the current
-- rules every time the queue is read.
--
-- Additive, and it applies before the merge. Nothing here constrains a write
-- the running deployment makes: `claim_submission.outcome` is not yet paired
-- with `decided_at` by a CHECK, because the running conflict resolver decides
-- claims without writing it. The pairing follows once that code has shipped.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Kinds
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'queue_subject') THEN
    CREATE TYPE "queue_subject" AS ENUM ('change_request', 'claim', 'conflict', 'credential', 'location');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_outcome') THEN
    CREATE TYPE "claim_outcome" AS ENUM ('approved', 'rejected', 'withdrawn');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A claim's decision says which way it went, and who made it
-- ─────────────────────────────────────────────────────────────────────────────

-- `status` describes the listing and cannot describe the decision: the conflict
-- resolver wrote `claimed` onto both submissions of an award, the losing one
-- included. `outcome` is the decision itself.
ALTER TABLE "claim_submission"
  ADD COLUMN IF NOT EXISTS "outcome"       "claim_outcome",
  ADD COLUMN IF NOT EXISTS "decided_by_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_submission_decided_by_id_fkey') THEN
    ALTER TABLE "claim_submission"
      ADD CONSTRAINT "claim_submission_decided_by_id_fkey"
      FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- The decisions already taken, in the new column. A claim decided with the
-- listing left claimed was granted; anything else decided was not.
UPDATE "claim_submission"
   SET "outcome" = CASE WHEN "status" = 'claimed' THEN 'approved'::"claim_outcome" ELSE 'rejected'::"claim_outcome" END
 WHERE "decided_at" IS NOT NULL AND "outcome" IS NULL;

-- The open claims, oldest first: the queue's claim read.
CREATE INDEX IF NOT EXISTS "claim_submission_open_idx"
  ON "claim_submission" ("created_at", "id") WHERE "decided_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. What an uploaded licence turned out to be — board 2b criterion 8, kept
-- ─────────────────────────────────────────────────────────────────────────────

-- The classifier ran on upload and its verdict was shown to the claimant and
-- then thrown away, so the reviewer could not see the one warning written for
-- them. Stored on the document, by the server that read it.
ALTER TABLE "document"
  ADD COLUMN IF NOT EXISTS "detected_kind" TEXT,
  ADD COLUMN IF NOT EXISTS "scanned_at"    TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_detected_kind_known') THEN
    ALTER TABLE "document"
      ADD CONSTRAINT "document_detected_kind_known"
      CHECK ("detected_kind" IS NULL OR "detected_kind" IN (
        'trade_licence', 'unknown', 'health_authority', 'municipality_permit', 'vat_certificate',
        'establishment_card', 'chamber_certificate', 'passport_or_id'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_scan_is_whole') THEN
    ALTER TABLE "document"
      ADD CONSTRAINT "document_scan_is_whole"
      CHECK (("detected_kind" IS NULL) = ("scanned_at" IS NULL));
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The queue's own state
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "queue_item" (
  "id"                   TEXT NOT NULL,
  "subject_type"         "queue_subject" NOT NULL,
  "subject_id"           TEXT NOT NULL,
  "business_id"          TEXT NOT NULL,

  -- Who is working it. Null is unassigned, which is a state the queue shows.
  "assignee_id"          UUID,
  "assigned_at"          TIMESTAMP(3),
  "assigned_by_id"       UUID,

  -- A document asked for, with the words the seller reads, and when one came back.
  "docs_requested_at"    TIMESTAMP(3),
  "docs_requested_by_id" UUID,
  "docs_request_reason"  TEXT,
  "docs_received_at"     TIMESTAMP(3),

  -- A staff decision the subject's own table has no column for: a branch
  -- published outside the licensed emirate. `subject_version` is the emirate
  -- decided on, so moving the branch again puts it back in front of a person.
  "decided_at"           TIMESTAMP(3),
  "decided_by_id"        UUID,
  "decision"             TEXT,
  "decision_reason"      TEXT,
  "subject_version"      TEXT,

  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "queue_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "queue_item_assignment_is_whole" CHECK (
    ("assignee_id" IS NULL) = ("assigned_at" IS NULL)
  ),
  CONSTRAINT "queue_item_request_says_what" CHECK (
    ("docs_requested_at" IS NULL AND "docs_request_reason" IS NULL AND "docs_requested_by_id" IS NULL)
    OR ("docs_requested_at" IS NOT NULL AND "docs_request_reason" IS NOT NULL AND btrim("docs_request_reason") <> '')
  ),
  CONSTRAINT "queue_item_received_after_request" CHECK (
    "docs_received_at" IS NULL OR ("docs_requested_at" IS NOT NULL AND "docs_received_at" >= "docs_requested_at")
  ),
  CONSTRAINT "queue_item_decision_is_whole" CHECK (
    ("decided_at" IS NULL AND "decision" IS NULL AND "decision_reason" IS NULL AND "subject_version" IS NULL)
    OR ("decided_at" IS NOT NULL AND "decision" IN ('approved', 'rejected')
      AND "decision_reason" IS NOT NULL AND btrim("decision_reason") <> '' AND "subject_version" IS NOT NULL)
  ),
  -- Every other kind is decided on its own table; only a branch review is decided here.
  CONSTRAINT "queue_item_decision_only_for_branches" CHECK (
    "decided_at" IS NULL OR "subject_type"::text = 'location'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "queue_item_subject_key" ON "queue_item" ("subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "queue_item_assignee_idx" ON "queue_item" ("assignee_id") WHERE "assignee_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "queue_item_business_idx" ON "queue_item" ("business_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queue_item_business_id_fkey') THEN
    ALTER TABLE "queue_item"
      ADD CONSTRAINT "queue_item_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queue_item_assignee_id_fkey') THEN
    ALTER TABLE "queue_item"
      ADD CONSTRAINT "queue_item_assignee_id_fkey"
      FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queue_item_assigned_by_id_fkey') THEN
    ALTER TABLE "queue_item"
      ADD CONSTRAINT "queue_item_assigned_by_id_fkey"
      FOREIGN KEY ("assigned_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queue_item_docs_requested_by_id_fkey') THEN
    ALTER TABLE "queue_item"
      ADD CONSTRAINT "queue_item_docs_requested_by_id_fkey"
      FOREIGN KEY ("docs_requested_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queue_item_decided_by_id_fkey') THEN
    ALTER TABLE "queue_item"
      ADD CONSTRAINT "queue_item_decided_by_id_fkey"
      FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
