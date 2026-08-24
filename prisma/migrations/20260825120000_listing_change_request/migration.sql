-- Handoff 3, step 3. The queue criterion 8 fills.
--
-- Only trade name, category and licence details enter it. Photographs, hours,
-- products and descriptions publish immediately. The enum is what makes adding
-- a fourth a product decision rather than a one-line change in a service.
CREATE TYPE "moderated_field" AS ENUM ('trade_name', 'primary_category', 'licence');
CREATE TYPE "change_request_status" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

CREATE TABLE "listing_change_request" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "actor_id"        UUID NOT NULL,
  "field"           "moderated_field" NOT NULL,
  "before_value"    TEXT,
  "after_value"     TEXT NOT NULL,
  "status"          "change_request_status" NOT NULL DEFAULT 'pending',
  "decision_reason" TEXT,
  "decided_by_id"   UUID,
  "decided_at"      TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "listing_change_request_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "listing_change_request"
  ADD CONSTRAINT "listing_change_request_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, not cascade. Deleting the account that asked for a change must not
-- delete the record that it was asked for.
ALTER TABLE "listing_change_request"
  ADD CONSTRAINT "listing_change_request_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "listing_change_request"
  ADD CONSTRAINT "listing_change_request_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CLAUDE.md non-negotiable 3: every staff state change writes a reason. An
-- approval or a rejection is a staff decision about what the public sees, so a
-- decided row without one is not a valid row. Paired both ways, the same shape
-- as `review_removal_has_a_reason` — a reason with no decision means somebody
-- wrote half a change.
ALTER TABLE "listing_change_request"
  ADD CONSTRAINT "change_request_decision_has_a_reason"
  CHECK (
    (("status" IN ('pending', 'withdrawn')) AND "decision_reason" IS NULL AND "decided_at" IS NULL)
    OR
    (("status" IN ('approved', 'rejected')) AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
  );

-- The queue reads pending, oldest first. The dashboard reads one business.
CREATE INDEX IF NOT EXISTS "listing_change_request_status_created_at_idx"
  ON "listing_change_request" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "listing_change_request_business_id_status_idx"
  ON "listing_change_request" ("business_id", "status");
