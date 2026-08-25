-- Handoff 3, step 5. Claiming a listing, and asking for the visit tier 3 needs.

CREATE TYPE "claim_route" AS ENUM ('licence_upload', 'phone_callback');

CREATE TABLE "claim_submission" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "claimant_id"     UUID NOT NULL,
  "route"           "claim_route" NOT NULL,
  "document_id"     TEXT,
  "phone"           TEXT,
  -- Somebody else already held it. The submission is still taken: a conflicting
  -- claim is a thing staff need to see, not a door to close in front of the
  -- second person, who may well be the real owner.
  "contested"       BOOLEAN NOT NULL DEFAULT false,
  "status"          "claim_status" NOT NULL DEFAULT 'unclaimed',
  "decided_at"      TIMESTAMP(3),
  "decision_reason" TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "claim_submission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "claim_submission"
  ADD CONSTRAINT "claim_submission_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "claim_submission"
  ADD CONSTRAINT "claim_submission_claimant_id_fkey"
  FOREIGN KEY ("claimant_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not SET NULL. The check below requires a licence claim to carry its
-- document, so nulling the column on delete produces a row that violates its
-- own constraint — the delete fails with a confusing error about the claim
-- rather than a clear one about the document. A licence claim without its
-- licence is not a claim, so deleting the evidence is refused while it is open.
ALTER TABLE "claim_submission"
  ADD CONSTRAINT "claim_submission_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CLAUDE.md non-negotiable 3. Approving or rejecting a claim decides who owns a
-- listing, which is about as consequential as a staff decision gets here.
ALTER TABLE "claim_submission"
  ADD CONSTRAINT "claim_decision_has_a_reason"
  CHECK (("decided_at" IS NULL) = ("decision_reason" IS NULL));

-- Each route has to carry the thing that route is. A licence claim with no
-- document and a phone claim with no number are both a form that half-posted.
ALTER TABLE "claim_submission"
  ADD CONSTRAINT "claim_route_carries_its_evidence"
  CHECK (
    ("route" = 'licence_upload' AND "document_id" IS NOT NULL)
    OR
    ("route" = 'phone_callback' AND "phone" IS NOT NULL)
  );

CREATE TABLE "site_visit_request" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "preferred_note"  TEXT,
  "scheduled_for"   TIMESTAMP(3),
  "completed_at"    TIMESTAMP(3),
  "cancelled_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "site_visit_request_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "site_visit_request"
  ADD CONSTRAINT "site_visit_request_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_visit_request"
  ADD CONSTRAINT "site_visit_request_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "claim_submission_business_id_status_idx"
  ON "claim_submission" ("business_id", "status");
CREATE INDEX IF NOT EXISTS "claim_submission_status_created_at_idx"
  ON "claim_submission" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "site_visit_request_business_id_created_at_idx"
  ON "site_visit_request" ("business_id", "created_at");
