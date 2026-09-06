-- Board 3e — the two document classes, and the state a credential sits in
-- while nobody has looked at it.
--
-- The screen splits one table into two: `Verified by us` (trade licence, TRN)
-- and `Uploaded by you` (ISO, Civil Defence, DEWA). The split already existed
-- structurally — `PUBLISHABLE_DOCUMENT_KINDS` has never let a licence reach a
-- storefront — but the second class had nowhere to record three facts the board
-- asks for: the credential's own number, whether a moderator has looked, and
-- what they wrote when they did.
--
-- Three columns and one index. Nothing is dropped and nothing is rewritten.
--
-- The backfill is the load-bearing statement. `reviewed_at` gates the public
-- certificates block from this migration onwards, so a document that is public
-- today and has no review date would vanish off a storefront the moment the
-- code lands. Every already-public row is stamped with its own `created_at`:
-- these were seeded or set public deliberately, which is the decision the
-- column records, and back-dating it to the row's own creation is the honest
-- reading rather than stamping them all with today.
--
-- Every statement is idempotent. `migrate dev` regenerates hand-written DDL and
-- drops what it did not author otherwise.

-- ── 1 · the credential's own number ────────────────────────────────────────
ALTER TABLE "document"
  ADD COLUMN IF NOT EXISTS "reference" TEXT;

-- ── 2 · the review a seller is promised within two working days ────────────
ALTER TABLE "document"
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);

ALTER TABLE "document"
  ADD COLUMN IF NOT EXISTS "review_reason" TEXT;

-- ── 3 · nothing disappears off a storefront ────────────────────────────────
-- Guarded on NULL so a re-run cannot move a date a moderator has since set.
UPDATE "document"
   SET "reviewed_at" = "created_at"
 WHERE "is_public" = true
   AND "reviewed_at" IS NULL;

-- ── 4 · the queue, oldest first ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "document_is_public_reviewed_at_created_at_idx"
  ON "document" ("is_public", "reviewed_at", "created_at");

-- ── 5 · the notification template that outlived the cut ────────────────────
-- `notification_template` rows are staff-editable on /admin/notifications, so
-- fixing the seed reaches a fresh database and no live one. This is the case
-- docs/inferred.md names: a product cut reaches code and seeds, the live rows
-- survive, and no CI scan reads a database.
--
-- The body promised "Verification drops to tier 2 the day it lapses" — the
-- schema's own pre-cut wording, and wrong in the dangerous direction, because
-- tier 2 *is* licence verification and a listing left there keeps the badge the
-- expiry is supposed to withdraw. It drops to tier 1.
--
-- Matched on the old text, so a staff member who has already rewritten this
-- keeps their words. A row that does not match is left alone rather than
-- overwritten.
UPDATE "notification_template"
   SET "subject" = 'Your trade licence expires {expiresAt} — {days} days',
       "body" = 'The trade licence on your listing expires {expiresAt}, in {days} days. On the day it lapses your listing stops showing the licence-verified badge and stops matching the licence-verified filter, with no grace period. Your listing, products and enquiries are not affected, and the badge returns as soon as we have checked a renewal.'
 WHERE "event" = 'document_expiring'
   AND "body" LIKE '%drops to tier 2 the day it lapses%';

-- ── 6 · the rung nobody can reach, emptied ─────────────────────────────────
-- Board 3e's ladder is `1 claimed → 2 licence verified (top) → 3 trade
-- references (reserved)`. Rung 3 is drawn so the ladder has somewhere to go and
-- carries no affordance, because nothing behind it is built.
--
-- Rows were still sitting on it. Before the site-visit cut, tier 3 meant
-- "verified by site visit" — the one piece of evidence this platform stopped
-- gathering — and the cut renamed the rung twice without ever moving the rows.
-- So a listing stored at 3 renders a header reading `Tier 3 · Trade references`
-- over a ladder drawing that rung as unreached, which is what the seller's own
-- screen showed the first time anybody opened it.
--
-- Two is where they belong: their licence was checked against the issuing
-- authority, which is true and is the whole of what we can say. Nothing is lost
-- — `VERIFIED_TIER` is 2, so the badge, the filter and the ranking weight are
-- unchanged; what goes is a claim about a visit nobody made.
--
-- `verified_at` is untouched. It records that a check happened on a date, and
-- it did.
--
-- No audit row, and deliberately. `AuditEvent.actorId` is NOT NULL because the
-- log records decisions, and this is a published decision already taken — the
-- cut of 5 September — being applied to rows a code change cannot reach. The
-- same argument the nightly sweeps make.
UPDATE "business"
   SET "verification_tier" = 2
 WHERE "verification_tier" > 2;
