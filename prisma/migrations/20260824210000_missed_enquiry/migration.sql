-- Handoff 3, step 1. The rows board 11a argues from.
--
-- lib/enquiry/fanout.ts has always computed `skipped` and its own comment says
-- what for: "the seller's own 'you missed N enquiries this month' nudge".
-- createEnquiry returned it to the caller and wrote nothing, so the number the
-- free dashboard exists to show did not survive the request that produced it.
--
-- Not a new RecipientState. `enquiry_recipient` means the business received the
-- enquiry, and a capped seller did not — the leads inbox, the nav badges and
-- the response-time median all filter on that state and would each have had to
-- remember to exclude a delivery that never happened.
CREATE TYPE "skip_reason" AS ENUM ('at_monthly_cap');

CREATE TABLE "missed_enquiry" (
  "enquiry_id"  TEXT        NOT NULL,
  "business_id" TEXT        NOT NULL,
  "reason"      "skip_reason" NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "missed_enquiry_pkey" PRIMARY KEY ("enquiry_id", "business_id")
);

-- Both cascade: a missed enquiry is a fact about a pairing, and it is
-- meaningless once either side is gone.
ALTER TABLE "missed_enquiry"
  ADD CONSTRAINT "missed_enquiry_enquiry_id_fkey"
  FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "missed_enquiry"
  ADD CONSTRAINT "missed_enquiry_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Board 11a reads this one way only: one business, most recent first, within
-- the current month. IF NOT EXISTS because `migrate dev` will otherwise author
-- a migration that drops a hand-written index — see docs/database.md.
CREATE INDEX IF NOT EXISTS "missed_enquiry_business_id_created_at_idx"
  ON "missed_enquiry" ("business_id", "created_at");
