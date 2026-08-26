-- Handoff 4, step 1. Moderation, the four-way claim resolution, and a spec
-- library whose new required fields do not break the products already filed
-- against it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Resolving a conflicting claim
--
-- `ClaimStatus` (unclaimed | claimed | disputed) describes the listing. It
-- cannot describe what staff decided, and two of the four outcomes create or
-- restructure businesses — so the resolution needs its own record naming what
-- it produced, or the audit row is unreadable a year later.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "claim_resolution" AS ENUM (
  'award_to_a',
  'award_to_b',
  'split_into_two',
  'merge_as_branches'
);

CREATE TABLE "claim_conflict" (
  "id"              TEXT NOT NULL,
  -- The listing both parties want. Kept even after a split, because it is the
  -- row buyers already have links to.
  "business_id"     TEXT NOT NULL,
  "submission_a_id" TEXT NOT NULL,
  "submission_b_id" TEXT NOT NULL,
  "resolution"      "claim_resolution",
  "resolved_by_id"  UUID,
  "resolved_at"     TIMESTAMP(3),
  "reason"          TEXT,
  -- What the resolution produced: the second listing on a split, or the branch
  -- it became on a merge. Null for the two award outcomes, which create nothing.
  "produced_business_id" TEXT,
  "produced_location_id" TEXT,
  -- Buyers waiting on this listing when it was resolved. Board 4c puts this in
  -- front of the decision because it is the real cost of the delay, and it is
  -- recorded because it is only true at the moment somebody looked.
  "buyers_waiting"  INTEGER NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "claim_conflict_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT on both submissions: a conflict that has lost one of its two sides
-- is not a record of anything, and the pair is what makes it reviewable.
ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_submission_a_id_fkey"
  FOREIGN KEY ("submission_a_id") REFERENCES "claim_submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_submission_b_id_fkey"
  FOREIGN KEY ("submission_b_id") REFERENCES "claim_submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_produced_business_id_fkey"
  FOREIGN KEY ("produced_business_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_produced_location_id_fkey"
  FOREIGN KEY ("produced_location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The same pairing of rule the change-request queue uses: undecided carries no
-- reason and no decider, decided carries both. CLAUDE.md non-negotiable 3, at
-- the only level that cannot be skipped by a second code path.
ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_decision_has_a_reason"
  CHECK (
    ("resolution" IS NULL AND "resolved_at" IS NULL AND "reason" IS NULL)
    OR
    ("resolution" IS NOT NULL AND "resolved_at" IS NOT NULL AND "reason" IS NOT NULL)
  );

-- Two sides, not one twice.
ALTER TABLE "claim_conflict"
  ADD CONSTRAINT "claim_conflict_two_sides"
  CHECK ("submission_a_id" <> "submission_b_id");

-- One open conflict per listing. A second would let two staff resolve the same
-- dispute in different directions.
CREATE UNIQUE INDEX IF NOT EXISTS "claim_conflict_one_open_per_business"
  ON "claim_conflict" ("business_id") WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "claim_conflict_open_created_at_idx"
  ON "claim_conflict" ("created_at") WHERE "resolved_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The spec grace period
--
-- Criterion 4: publishing a template version with a new required field must not
-- invalidate the products already filed against it. So "required" stops being a
-- boolean at a point in time and becomes a date it starts applying from.
--
-- `required` stays, because a field required from the beginning is the common
-- case and `required_from` on every row would be noise. The two are read
-- together: required AND (required_from IS NULL OR required_from <= now).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "spec_field"
  ADD COLUMN "required_from" TIMESTAMP(3);

ALTER TABLE "spec_field"
  ADD CONSTRAINT "spec_field_grace_needs_required"
  CHECK ("required_from" IS NULL OR "required" = true);

CREATE INDEX IF NOT EXISTS "spec_field_required_from_idx"
  ON "spec_field" ("template_id", "required_from") WHERE "required_from" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seller-proposed fields, and their promotion
--
-- "Seller-proposed custom fields that appear often enough get promoted into the
-- shared template; that promotion path is what stops 40,000 businesses
-- inventing 40,000 attribute names."
--
-- `SellerTemplate.fieldMappings` is an opaque Json blob, so "appears often
-- enough" was not a countable thing. One row per (category, normalised key)
-- with a business count makes it one.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "proposal_state" AS ENUM ('proposed', 'promoted', 'declined');

CREATE TABLE "spec_field_proposal" (
  "id"          TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  -- Lowercased and punctuation-stripped, so "Wall Thk." and "wall thk" are one
  -- proposal rather than two. The label a seller typed is kept separately.
  "key"         TEXT NOT NULL,
  "sample_label" TEXT NOT NULL,
  "business_count" INTEGER NOT NULL DEFAULT 0,
  "state"       "proposal_state" NOT NULL DEFAULT 'proposed',
  "promoted_field_id" TEXT,
  "decided_by_id" UUID,
  "decided_at"  TIMESTAMP(3),
  "reason"      TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "spec_field_proposal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "spec_field_proposal"
  ADD CONSTRAINT "spec_field_proposal_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spec_field_proposal"
  ADD CONSTRAINT "spec_field_proposal_promoted_field_id_fkey"
  FOREIGN KEY ("promoted_field_id") REFERENCES "spec_field"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "spec_field_proposal"
  ADD CONSTRAINT "spec_field_proposal_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "spec_field_proposal"
  ADD CONSTRAINT "spec_field_proposal_decision_has_a_reason"
  CHECK (
    ("state" = 'proposed' AND "decided_at" IS NULL AND "reason" IS NULL)
    OR
    ("state" <> 'proposed' AND "decided_at" IS NOT NULL AND "reason" IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "spec_field_proposal_category_key_key"
  ON "spec_field_proposal" ("category_id", "key");

CREATE INDEX IF NOT EXISTS "spec_field_proposal_ranked_idx"
  ON "spec_field_proposal" ("state", "business_count" DESC);
