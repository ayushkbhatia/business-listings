-- Board 11c — reviews: request, reply, dispute.
--
-- Additive throughout. Two enums, one table, three nullable columns, two
-- indexes and two check constraints. Nothing here rewrites a row that already
-- exists, so it is safe to apply before the code that reads it —
-- docs/deployments.md § Ordering.
--
-- ## What each piece is for
--
-- `review_dispute` is `B5`: the board promised a decision in two working days
-- and named no queue to make it in. Four grounds as reason codes, two outcomes,
-- and a written reason on the outcome, so "how many abuse disputes did we
-- uphold" is a question the queue can answer about itself.
--
-- `review.reply_removed_at` is `B4`: the board considered a reply that is
-- permanent and never a reply that itself breaches policy. The seller keeps
-- their one reply either way — the text stays as the record of what was said
-- and every reader hides it — because a seller who abused the reply does not
-- earn a second one.
--
-- `supplier_report.review_id` is `B6`: the request panel has promised since
-- board 1m that "an incentivised review is removed and logged against your
-- account", and there was nowhere to write the finding. `review_integrity` has
-- been a report kind that whole time with nothing to join it to.
--
-- The index on `enquiry` is `B7`: the acceptance timestamp was stored and was
-- not queryable. Every load of /dashboard/reviews scanned the enquiry table.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The four grounds, and the two outcomes
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Declaration order is sort order in Postgres, so the grounds are declared in
-- the order the rail lists them: 01 no traceable enquiry, 02 abuse, 03 private
-- information, 04 provably false. A moderator's queue grouped by ground and the
-- seller's rail then read in the same sequence without either sorting by hand.

DO $$ BEGIN
  CREATE TYPE "review_dispute_ground" AS ENUM (
    'no_traceable_enquiry',
    'abuse',
    'private_information',
    'provably_false'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "review_dispute_outcome" AS ENUM ('upheld', 'refused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The dispute
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "review_dispute" (
  "id"              TEXT NOT NULL,
  "review_id"       TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "raised_by_id"    UUID NOT NULL,
  "ground"          "review_dispute_ground" NOT NULL,
  "detail"          TEXT NOT NULL,
  "outcome"         "review_dispute_outcome",
  "outcome_reason"  TEXT,
  "resolved_at"     TIMESTAMP(3),
  "decided_by_id"   UUID,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_dispute_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_review_fkey"
    FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_raised_by_fkey"
    FOREIGN KEY ("raised_by_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_decided_by_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A resolution is an outcome, a reason and a date, or it is none of them.
--
-- The same rule CLAUDE.md's third non-negotiable puts on every staff state
-- change, enforced here rather than only in the service layer: an outcome that
-- reached the table without its explanation would be a decision nobody has to
-- account for, and this is the queue whose whole promise to a seller is that
-- "the outcome and the reason are logged and sent to you".
ALTER TABLE "review_dispute" DROP CONSTRAINT IF EXISTS "review_dispute_resolution_is_whole";
ALTER TABLE "review_dispute" ADD CONSTRAINT "review_dispute_resolution_is_whole"
  CHECK (
    ("outcome" IS NULL AND "outcome_reason" IS NULL AND "resolved_at" IS NULL)
    OR ("outcome" IS NOT NULL AND "outcome_reason" IS NOT NULL AND "resolved_at" IS NOT NULL)
  );

-- The queue, open first and oldest first. `outcome IS NULL` is the open set and
-- it is the leading column, so the read the console makes on every load never
-- touches a resolved row.
CREATE INDEX IF NOT EXISTS "review_dispute_queue_idx"
  ON "review_dispute" ("outcome", "created_at");

CREATE INDEX IF NOT EXISTS "review_dispute_business_idx"
  ON "review_dispute" ("business_id", "created_at");

-- One **open** dispute per review, which Prisma cannot express: a partial
-- unique index is the only way to say "at most one row where resolved_at is
-- null" without also forbidding the second, later dispute that a buyer's edit
-- inside their fortnight legitimately produces.
--
-- Two tabs on the same review is the case this actually stops. Without it a
-- seller who double-submits files two disputes on one review and a moderator
-- decides the same case twice, on the queue whose SLA is two working days.
CREATE UNIQUE INDEX IF NOT EXISTS "review_dispute_one_open_per_review"
  ON "review_dispute" ("review_id") WHERE "resolved_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A reply that itself breaches policy
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "reply_removed_at" TIMESTAMP(3);
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "reply_removal_reason" TEXT;

-- Removed and reasoned together, and only against a reply that exists.
--
-- The second half is the one that matters: without it a row could carry a
-- removal for a reply nobody ever posted, which every reader would render as
-- "this seller's reply was taken down" over an empty reply box.
ALTER TABLE "review" DROP CONSTRAINT IF EXISTS "review_reply_removal_is_reasoned";
ALTER TABLE "review" ADD CONSTRAINT "review_reply_removal_is_reasoned"
  CHECK (
    ("reply_removed_at" IS NULL AND "reply_removal_reason" IS NULL)
    OR ("reply_removed_at" IS NOT NULL AND "reply_removal_reason" IS NOT NULL
        AND "seller_reply" IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The incentivised-review log gets something to point at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "supplier_report" ADD COLUMN IF NOT EXISTS "review_id" TEXT;

-- SET NULL rather than CASCADE. Removing the review is frequently the outcome
-- of the finding, and a log that deletes itself when the thing it found is
-- acted on is not a log.
DO $$ BEGIN
  ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_review_fkey"
    FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "supplier_report_review_idx"
  ON "supplier_report" ("review_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The decision has to reach the seller
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The rail promises "decided by our team in about 2 working days — the outcome
-- and the reason are logged and sent to you", and §States repeats it for both
-- outcomes. A promise in shipped copy with no emitter behind it is the
-- unowned-commitment shape board 4e Q2 already got wrong once, so the event is
-- declared here and `onReviewDisputeDecided` sends it.
--
-- `BEFORE 'weekly_digest'` like every other event added since handoff 2: the
-- digest is the catch-all and sorts last, and enum order is declaration order
-- in Postgres. Additive, and used by nothing in this transaction — which is
-- what makes `ADD VALUE` safe inside one.
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'review_dispute_decided' BEFORE 'weekly_digest';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Who a seller may ask — B7
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The eligible-buyer read filters on both columns together: accepted by this
-- business, inside the ninety-day window. It had no index and scanned every
-- enquiry on the platform to find the two names on the panel.
CREATE INDEX IF NOT EXISTS "enquiry_accepted_idx"
  ON "enquiry" ("contact_released_to_business_id", "contact_released_at");
