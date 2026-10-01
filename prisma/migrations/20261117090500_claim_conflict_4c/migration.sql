-- Board `4c` — review a submission: two or more claims on one listing, scored
-- on the same rows, and one resolve call whichever control invoked it.
--
-- Three things, all additive:
--
--   1. **`claim_submission.outcome` is paired with `decided_at`** (build plan
--      4.3, owed by board 4b: "the CHECK follows once the running resolver
--      writes it"). It does: `approveClaim`, `rejectClaim`, `withdrawClaim` and
--      `resolveConflict` all write an outcome with every decision. Rows decided
--      before 4b shipped are backfilled first — a conflict's sides from its
--      resolution (the loser of an award was `rejected`, both sides of a split
--      or a merge `approved`), anything else from `status`, the same rule 4b's
--      own backfill used.
--
--   2. **A conflict holds any number of claims, not two.** `conflict_id` on the
--      claim is the set; `submission_a_id` / `submission_b_id` stay as the
--      first two, and `submission_b_id` becomes nullable because a *challenge* — a
--      claim on a listing that already has an owner — has one claim and an
--      incumbent, not two claims (§Flagged 2). The winner is `awarded_submission_id`, so an
--      award no longer names a side by position.
--
--   3. **The conflict's own states** (§States): escalated to a named holder
--      with the clock paused (Q5), tenancy documents requested of every side
--      with the clock running (Q4), and dissolved when withdrawals leave one
--      claim standing. Each paired by a CHECK, so a half-written state cannot
--      exist.
--
-- What a claimant who did not win is told is `party_reason` — one of four
-- fixed sentences — never the internal note, which stays on
-- `claim_conflict.reason` and the audit row (`B4`).
--
-- ## Ordering
--
-- **Additive, and applies before the merge**, after
-- `20261117090000_claim_conflict_enums_4c`, whose values two CHECKs name. Every
-- new column is nullable or defaulted, the relaxed NOT NULL only widens
-- what may be written, and no row is given a value the deployed client cannot
-- read. The backfill writes `outcome` values that already exist.
--
-- Idempotent: every column, constraint and index is guarded, so a second run is
-- a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. What a claimant is told
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_party_reason') THEN
    CREATE TYPE "claim_party_reason" AS ENUM (
      'not_source_licence',
      'details_do_not_match',
      'not_confirmed_by_phone',
      'documents_not_received'
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The claim
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "claim_submission"
  ADD COLUMN IF NOT EXISTS "conflict_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "party_reason"        "claim_party_reason",
  ADD COLUMN IF NOT EXISTS "tenancy_document_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_submission_conflict_id_fkey') THEN
    ALTER TABLE "claim_submission"
      ADD CONSTRAINT "claim_submission_conflict_id_fkey"
      FOREIGN KEY ("conflict_id") REFERENCES "claim_conflict"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- SET NULL rather than the licence's RESTRICT: a tenancy contract is the
  -- closure purge's to delete after its retention window, and the claim record
  -- outlives the file.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_submission_tenancy_document_id_fkey') THEN
    ALTER TABLE "claim_submission"
      ADD CONSTRAINT "claim_submission_tenancy_document_id_fkey"
      FOREIGN KEY ("tenancy_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "claim_submission_conflict_idx" ON "claim_submission" ("conflict_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The conflict
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "claim_conflict"
  ALTER COLUMN "submission_b_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "challenge"             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "incumbent_id"          UUID,
  ADD COLUMN IF NOT EXISTS "awarded_submission_id" TEXT,
  ADD COLUMN IF NOT EXISTS "second_submission_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "escalated_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "escalated_by_id"       UUID,
  ADD COLUMN IF NOT EXISTS "escalated_to_id"       UUID,
  ADD COLUMN IF NOT EXISTS "escalation_note"       TEXT,
  ADD COLUMN IF NOT EXISTS "docs_requested_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "docs_requested_by_id"  UUID,
  ADD COLUMN IF NOT EXISTS "docs_request_note"     TEXT,
  ADD COLUMN IF NOT EXISTS "docs_received_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dissolved_at"          TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_awarded_submission_id_fkey') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_awarded_submission_id_fkey"
      FOREIGN KEY ("awarded_submission_id") REFERENCES "claim_submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_second_submission_id_fkey') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_second_submission_id_fkey"
      FOREIGN KEY ("second_submission_id") REFERENCES "claim_submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_incumbent_id_fkey') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_incumbent_id_fkey"
      FOREIGN KEY ("incumbent_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_escalated_by_id_fkey') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_escalated_by_id_fkey"
      FOREIGN KEY ("escalated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_escalated_to_id_fkey') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_escalated_to_id_fkey"
      FOREIGN KEY ("escalated_to_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_docs_requested_by_id_fkey') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_docs_requested_by_id_fkey"
      FOREIGN KEY ("docs_requested_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfills, before the constraints that read them
-- ─────────────────────────────────────────────────────────────────────────────

-- Every conflict's two sides join it by `conflict_id`, the set the code reads.
UPDATE "claim_submission" s
   SET "conflict_id" = c."id"
  FROM "claim_conflict" c
 WHERE s."conflict_id" IS NULL
   AND (s."id" = c."submission_a_id" OR s."id" = c."submission_b_id");

-- The winner of a resolved conflict, named by id rather than by position, and
-- the second side of a split or a merge.
UPDATE "claim_conflict"
   SET "awarded_submission_id" = CASE "resolution"
         WHEN 'award_to_b' THEN "submission_b_id"
         ELSE "submission_a_id"
       END,
       "second_submission_id" = CASE
         WHEN "resolution" IN ('split_into_two', 'merge_as_branches') THEN "submission_b_id"
         ELSE NULL
       END
 WHERE "resolved_at" IS NOT NULL
   AND "awarded_submission_id" IS NULL
   AND "resolution" IN ('award_to_a', 'award_to_b', 'split_into_two', 'merge_as_branches');

-- A conflict's sides decided before board 4b, from the resolution: the loser of
-- an award was rejected, and a split or a merge granted both.
UPDATE "claim_submission" s
   SET "outcome" = CASE
         WHEN c."resolution" = 'award_to_a' AND s."id" = c."submission_b_id" THEN 'rejected'::"claim_outcome"
         WHEN c."resolution" = 'award_to_b' AND s."id" = c."submission_a_id" THEN 'rejected'::"claim_outcome"
         ELSE 'approved'::"claim_outcome"
       END
  FROM "claim_conflict" c
 WHERE s."decided_at" IS NOT NULL
   AND s."outcome" IS NULL
   AND c."resolved_at" IS NOT NULL
   AND (s."id" = c."submission_a_id" OR s."id" = c."submission_b_id");

-- Anything else decided without an outcome, by board 4b's own rule.
UPDATE "claim_submission"
   SET "outcome" = CASE WHEN "status" = 'claimed' THEN 'approved'::"claim_outcome" ELSE 'rejected'::"claim_outcome" END
 WHERE "decided_at" IS NOT NULL
   AND "outcome" IS NULL;

-- An outcome on a claim nobody decided is not a state any writer produces.
-- None should exist; if one does, it is the decision that is missing, and
-- clearing a stray outcome is the only repair that invents nothing.
UPDATE "claim_submission"
   SET "outcome" = NULL
 WHERE "decided_at" IS NULL
   AND "outcome" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Constraints
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Build plan 4.3's owed pairing: undecided has no outcome, decided has one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_submission_outcome_with_decision') THEN
    ALTER TABLE "claim_submission"
      ADD CONSTRAINT "claim_submission_outcome_with_decision"
      CHECK (("outcome" IS NULL) = ("decided_at" IS NULL));
  END IF;

  -- A reason is what a claimant who lost is told. Nobody else is sent one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_submission_party_reason_on_rejection') THEN
    ALTER TABLE "claim_submission"
      ADD CONSTRAINT "claim_submission_party_reason_on_rejection"
      CHECK ("party_reason" IS NULL OR "outcome" = 'rejected');
  END IF;

  -- Escalated means a holder and a note, together. `escalated_by_id` is left
  -- out: it may outlive its user (SET NULL), and the audit row keeps the actor.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_escalation_is_whole') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_escalation_is_whole"
      CHECK (
        ("escalated_at" IS NULL AND "escalation_note" IS NULL AND "escalated_to_id" IS NULL)
        OR ("escalated_at" IS NOT NULL AND "escalation_note" IS NOT NULL)
      );
  END IF;

  -- A request says what it asked for, and nothing arrives before it is asked.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_docs_request_says_what') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_docs_request_says_what"
      CHECK (("docs_requested_at" IS NULL) = ("docs_request_note" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_docs_received_after_request') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_docs_received_after_request"
      CHECK ("docs_received_at" IS NULL OR ("docs_requested_at" IS NOT NULL AND "docs_received_at" >= "docs_requested_at"));
  END IF;

  -- Decided, or dissolved by withdrawals — never both.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_resolved_or_dissolved') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_resolved_or_dissolved"
      CHECK ("resolved_at" IS NULL OR "dissolved_at" IS NULL);
  END IF;

  -- An incumbent belongs to a challenge, and keeping the owner is how only a
  -- challenge can end.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_incumbent_on_challenge') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_incumbent_on_challenge"
      CHECK ("incumbent_id" IS NULL OR "challenge");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_keep_owner_on_challenge') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_keep_owner_on_challenge"
      CHECK ("resolution" IS NULL OR "resolution" <> 'keep_owner' OR "challenge");
  END IF;

  -- A race has two claims from the start; only a challenge has one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_conflict_second_side_unless_challenge') THEN
    ALTER TABLE "claim_conflict"
      ADD CONSTRAINT "claim_conflict_second_side_unless_challenge"
      CHECK ("submission_b_id" IS NOT NULL OR "challenge");
  END IF;
END $$;

-- One open conflict per listing, where open now also means not dissolved: a
-- dissolved conflict must not stop the next one opening. Same name, new
-- definition, so the invariant keeps one identity (see the migration that
-- first wrote it, `20260826090000_moderation_taxonomy`).
DROP INDEX IF EXISTS "claim_conflict_one_open_per_business";
CREATE UNIQUE INDEX IF NOT EXISTS "claim_conflict_one_open_per_business"
  ON "claim_conflict" ("business_id") WHERE "resolved_at" IS NULL AND "dissolved_at" IS NULL;

DROP INDEX IF EXISTS "claim_conflict_open_created_at_idx";
CREATE INDEX IF NOT EXISTS "claim_conflict_open_created_at_idx"
  ON "claim_conflict" ("created_at") WHERE "resolved_at" IS NULL AND "dissolved_at" IS NULL;
