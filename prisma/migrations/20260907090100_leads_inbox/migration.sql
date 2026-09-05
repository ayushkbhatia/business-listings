-- Boards 3j and 11b — the leads inbox, and the four things it needs that the
-- schema could not express.
--
-- Every statement is idempotent. docs/database.md records the incident that made
-- this a rule: a hand-written migration whose statements were not guarded looked
-- like drift to `migrate dev`, which generated a second migration dropping them.
--
-- ## What is deliberately not here
--
-- No VAT column. The composer's totals block is the only place a seller types
-- money, and `quote.currency_note` already renders "All amounts in AED,
-- excluding VAT." beneath it. `admin.tax.scope` states the platform's position:
-- nothing a buyer pays a supplier passes through us, so there is no VAT position
-- on it here. A tax field would also move `quoteTotalAed`, which is the single
-- arithmetic behind the composer, the rail, /dashboard/quotes and the revision
-- delta both sides of a thread read — that helper exists so a buyer and a seller
-- cannot disagree about a number.
--
-- No won-value column. Board 3j asks for a seller-reported figure on "Mark won".
-- CLAUDE.md: derived metrics have no writable path, and quoted value is named in
-- that list. `business.quoted_value_aed` is already a column nothing reads or
-- writes; a second one would not make the first true.
--
-- No arrival-channel column. `createEnquiry` has exactly one caller, so the
-- column would carry one value for every row — a declared column with nothing to
-- distinguish, which is the failure this migration is mostly about repairing.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_outcome') THEN
    CREATE TYPE "lead_outcome" AS ENUM ('won', 'lost');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Assignment
--
-- `business.lead_routing` has been stored since the init migration and applied
-- nowhere: round robin routes nothing, because there was no column to route
-- *to*. `withinScope`, `canRespondToEnquiry` and `canSendQuote` have been
-- declared in lib/auth/subject.ts since handoff 0 with zero production callers,
-- and would have answered true for everything even if called — no enquiry table
-- carried an actor.
--
-- Nullable, and unassigned is the normal state. Board 7d's `everyone` routing
-- mode means exactly that, and a default assignee would quietly make one seat
-- responsible for a queue the whole team is meant to see.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "assigned_to_id" UUID;
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP(3);
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "assigned_by_id" UUID;

DO $$
BEGIN
    ALTER TABLE "enquiry_recipient" ADD CONSTRAINT "enquiry_recipient_assigned_to_id_fkey"
        FOREIGN KEY ("assigned_to_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `SET NULL`, not `RESTRICT`. Removing a seat must not be blocked by the leads
-- they once assigned, and must not delete the lead either — the enquiry still
-- happened. The row simply becomes unassigned, which is a state the inbox
-- already renders.
DO $$
BEGIN
    ALTER TABLE "enquiry_recipient" ADD CONSTRAINT "enquiry_recipient_assigned_by_id_fkey"
        FOREIGN KEY ("assigned_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Outcome
--
-- The rail counts `Won 14` and `Lost 9` and the request header carries both
-- buttons, and until now nothing on the screen could have produced either
-- number. `quote.status` accepted/lost and `enquiry_recipient.state = declined`
-- have one writer between them — the BUYER's acceptance — and `lost_reason` has
-- one writer with one value, 'buyer_accepted_another'.
--
-- So the seller's outcome is its own column rather than a reuse of the buyer's.
-- A seller marking a lead lost must not write a status the buyer's tracking page
-- reads as "this supplier was beaten", and a seller marking won must not imply a
-- contact release that did not happen.
--
-- It carries no amount. See the header.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "outcome" "lead_outcome";
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "outcome_at" TIMESTAMP(3);
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "outcome_by_id" UUID;
-- Free text, and only meaningful on a loss. Not required: a seller who does not
-- know why they lost must still be able to close the row, and a mandatory reason
-- would be answered with a full stop.
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "outcome_reason" TEXT;

DO $$
BEGIN
    ALTER TABLE "enquiry_recipient" ADD CONSTRAINT "enquiry_recipient_outcome_by_id_fkey"
        FOREIGN KEY ("outcome_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An outcome and its timestamp arrive together or not at all. Without this the
-- Won and Lost tabs can order by a null.
DO $$
BEGIN
    ALTER TABLE "enquiry_recipient" ADD CONSTRAINT "enquiry_recipient_outcome_dated"
        CHECK (("outcome" IS NULL) = ("outcome_at" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The follow-up, split in two
--
-- `nudged_at` was written by two different actors through two different
-- services: lib/enquiry/nudge.ts, where a BUYER prods a supplier who has not
-- answered, and lib/messaging/service.ts, where a SELLER follows up a buyer who
-- has gone quiet after a quote. One column, two meanings — so a buyer's nudge
-- consumed the seller's one-ever follow-up, and board 11b's rail then rendered
-- "Follow-up sent {when}" for a message the seller never sent.
--
-- `nudged_at` keeps its data and becomes the buyer's alone. `seller_nudged_at`
-- starts null for every existing row, and that is correct rather than lossy:
-- the seller's nudge stamped a column and sent nothing, so no buyer has ever
-- received one. Nobody is being given a second follow-up, because nobody has
-- had a first.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "seller_nudged_at" TIMESTAMP(3);

-- When the scheduled follow-up is due, and the words it will carry.
--
-- Board 11b makes both editable before it sends and gives the draft no price,
-- discount or deadline the seller did not type. Storing the body is what makes
-- that promise keepable: a draft composed at send time by the job would be text
-- the seller never saw.
--
-- Null due date means no follow-up is scheduled, which is also what cancelling
-- one looks like — the job has no separate "cancelled" state to leave behind.
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "nudge_due_at" TIMESTAMP(3);
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "nudge_body" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes the rail needs
--
-- `getLeadsForBusiness` had no `take`, no cursor and one index on
-- (business_id, state). The inbox adds four tab counts and an ordering, which
-- without these is five unbounded sequential reads per render on a page that
-- already runs two counts for the sidebar.
-- ─────────────────────────────────────────────────────────────────────────────

-- The rail's default read: this business, this tab, oldest first within a band.
CREATE INDEX IF NOT EXISTS "enquiry_recipient_inbox_idx"
  ON "enquiry_recipient"("business_id", "state", "created_at");

-- The Won and Lost tabs, newest first. Partial, because every open lead has a
-- null outcome and there is no reason to carry them in this index.
CREATE INDEX IF NOT EXISTS "enquiry_recipient_outcome_idx"
  ON "enquiry_recipient"("business_id", "outcome_at" DESC)
  WHERE "outcome" IS NOT NULL;

-- The overdue bands, and the escalation sweep that already reads this predicate
-- hourly. Partial for the same reason: a lead that has been answered is never
-- late again.
CREATE INDEX IF NOT EXISTS "enquiry_recipient_waiting_idx"
  ON "enquiry_recipient"("business_id", "created_at")
  WHERE "first_reply_at" IS NULL;

-- The follow-up sweep's read. Partial, so it stays the size of the work queue
-- rather than the size of the table.
CREATE INDEX IF NOT EXISTS "enquiry_recipient_nudge_due_idx"
  ON "enquiry_recipient"("nudge_due_at")
  WHERE "nudge_due_at" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- A message the platform wrote
--
-- The follow-up lands in the thread as a seller message, because that is what
-- the buyer receives and the thread is the record. But it was composed by a
-- schedule rather than typed, and board 11b tags it `AUTOMATIC` for that reason
-- — a buyer who replies to a person deserves to know when they did not get one.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "automatic" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Which enquiry line a quote line answers
--
-- The composer has always matched a previous quote's lines back onto the
-- buyer's by comparing `description`, and that is ambiguous on exactly the
-- enquiries this product is for: ENQ-8841 carries two lines both reading
-- "Resilient seated gate valve, flanged", separated only by `size`. A revision
-- prefilled from the wrong one puts the DN150 price against the DN100 row.
--
-- Board 3j's autosaved draft made it urgent — a draft restores only the lines
-- the seller had priced, so it has to know which rows those were — but the bug
-- predates it, and this column fixes both readers.
--
-- Nullable: every quote line written before now has no answer, and inventing
-- one by matching descriptions would bake today's ambiguity into the column.
-- `SET NULL` rather than cascade — deleting a buyer's line must not delete the
-- price a supplier quoted for it.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "quote_line" ADD COLUMN IF NOT EXISTS "enquiry_line_id" TEXT;

DO $$
BEGIN
    ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_enquiry_line_id_fkey"
        FOREIGN KEY ("enquiry_line_id") REFERENCES "enquiry_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "quote_line_enquiry_line_idx"
  ON "quote_line"("enquiry_line_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- When a quote was last touched
--
-- Board 3j §5 autosaves line edits as a draft, and docs/design-system.md makes
-- "Saved 20 seconds ago" the dashboard's autosave affordance. A seller coming
-- back to a half-priced quote needs to know when they left it, and `created_at`
-- answers a different question — when they started.
--
-- Backfilled to `created_at`, which is exactly right for every row that exists:
-- a sent quote has never been edited, because a revision is a new row rather
-- than an edit.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);
UPDATE "quote" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "quote" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "quote" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- ─────────────────────────────────────────────────────────────────────────────
-- Quote attachments
--
-- Board 3j §5: the composer's chips pull from the catalogue's datasheets and the
-- licence documents. A join rather than a `quote_id` on `document`, because
-- attaching is *referencing* — the same datasheet hangs off a product and off
-- every quote that cites it, and an owning column would force a copy per quote
-- and leave the storage object with two owners.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "quote_attachment" (
  "quote_id"    TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_attachment_pkey" PRIMARY KEY ("quote_id", "document_id")
);

DO $$
BEGIN
    ALTER TABLE "quote_attachment" ADD CONSTRAINT "quote_attachment_quote_id_fkey"
        FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `CASCADE`, so deleting the document removes the reference. The quote's own
-- line descriptions are what it priced; an attachment is supporting paper, and a
-- dangling row pointing at a deleted storage object would render as a chip that
-- 404s.
DO $$
BEGIN
    ALTER TABLE "quote_attachment" ADD CONSTRAINT "quote_attachment_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "quote_attachment_document_idx"
  ON "quote_attachment"("document_id");
