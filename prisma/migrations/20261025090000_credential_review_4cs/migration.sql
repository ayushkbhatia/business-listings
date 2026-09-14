-- Board 4c-s, board-level pass. Review a credential against the register that
-- issued it — a lookup with three fields that either match or do not, not a
-- judgement about a photograph.
--
-- Board 8b-s saved an FTA tax agent number, asked the register once, and kept
-- only the tier. What it could not hold is the rest of what 4c-s needs: what the
-- register actually said and when (B2), whether a person or the machine settled
-- it, why a rejection was a rejection (B5), and a request for a clearer document
-- that holds the credential in the queue rather than sending an email (B6).
--
-- Additive, and it applies before the merge. The running deployment writes
-- credentials with every new column null, and every CHECK below accepts that
-- row: a null review is the state of every credential no register can answer
-- for, which today is all of them.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Kinds
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_review') THEN
    CREATE TYPE "credential_review" AS ENUM ('auto_verified', 'pending', 'more_info', 'verified', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_reject_reason') THEN
    CREATE TYPE "credential_reject_reason" AS ENUM ('not_on_register', 'different_entity', 'lapsed', 'unreadable');
  END IF;
END
$$;

-- A credential row checked against a register is a queue subject of its own.
-- `credential` is board 3e's document asked to publish, which came first and
-- keeps its name: renaming an enum value the running code reads is a migration
-- with no safe order.
ALTER TYPE "queue_subject" ADD VALUE IF NOT EXISTS 'register_credential';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The review, on the credential
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "credential"
  ADD COLUMN IF NOT EXISTS "review"              "credential_review",
  ADD COLUMN IF NOT EXISTS "review_opened_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_by_id"      UUID,
  ADD COLUMN IF NOT EXISTS "review_note"         TEXT,
  ADD COLUMN IF NOT EXISTS "reject_reason"       "credential_reject_reason",
  ADD COLUMN IF NOT EXISTS "resubmitted_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "register_fetch"      JSONB,
  ADD COLUMN IF NOT EXISTS "register_fetched_at" TIMESTAMP(3);

-- A row the register already verified was settled by the machine. Named as
-- such, so the tier and the review agree from the first read.
UPDATE "credential"
   SET "review" = 'auto_verified', "review_opened_at" = "verified_on"
 WHERE "trust" = 'register_verified' AND "kind" = 'fta_tax_agent' AND "review" IS NULL;

-- The queue's read: what is open, oldest first.
CREATE INDEX IF NOT EXISTS "credential_review_open_idx" ON "credential" ("review", "review_opened_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_reviewed_by_id_fkey') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_reviewed_by_id_fkey"
      FOREIGN KEY ("reviewed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- B1. Only a kind a register can answer for may hold a review state. A
  -- pending badge on an indemnity schedule is a bug, not a backlog, and the
  -- database is the one place that cannot be talked out of it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_review_only_checkable') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_review_only_checkable"
      CHECK ("review" IS NULL OR "kind" = 'fta_tax_agent');
  END IF;

  -- A verification — the machine's or a person's — is the register tier, and
  -- nothing else is. The reviewer decides the review; the tier follows it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_review_tier_agrees') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_review_tier_agrees"
      CHECK ("review" IS NULL OR (("review" IN ('verified', 'auto_verified')) = ("trust" = 'register_verified')));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_review_has_a_clock') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_review_has_a_clock"
      CHECK (("review" IS NULL) = ("review_opened_at" IS NULL));
  END IF;

  -- A person's decision says what they wrote. Who stays nullable only so a
  -- departed member of staff does not delete the history of what they did.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_decision_is_whole') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_decision_is_whole"
      CHECK (
        (("reviewed_at" IS NULL) = ("review_note" IS NULL))
        AND ("review_note" IS NULL OR btrim("review_note") <> '')
        AND ("review" IS NULL OR "review" NOT IN ('verified', 'rejected', 'more_info') OR "reviewed_at" IS NOT NULL)
      );
  END IF;

  -- B5. A rejection carries one of the four reasons, and nothing else does.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_rejection_says_why') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_rejection_says_why"
      CHECK (("review" IS NOT DISTINCT FROM 'rejected') = ("reject_reason" IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_fetch_is_whole') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_fetch_is_whole"
      CHECK (("register_fetch" IS NULL) = ("register_fetched_at" IS NULL));
  END IF;
END
$$;
