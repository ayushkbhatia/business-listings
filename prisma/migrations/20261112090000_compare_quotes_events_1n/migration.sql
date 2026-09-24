-- Board `1n` — three notification events around a buyer choosing between quotes.
--
--  * `quote_declined`  — to every supplier whose quote lost when the buyer
--    accepted another (`B8`). Names nothing about the winner.
--  * `enquiry_nudged`  — the buyer's one nudge, carried to the supplier it was
--    meant for (`B10`). A reminder about an enquiry they already hold.
--  * `enquiry_closing` — to the buyer, once, inside the last day before an
--    enquiry with acceptable quotes closes (`10e` B3 makes the close terminal).
--
-- On their own, because Postgres refuses to use an enum value in the
-- transaction that added it; the templates that cast to them are in
-- `20261112090500_compare_quotes_templates_1n`, which applies after this.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- Values nothing deployed reads or sends.
--
-- Idempotent: `IF NOT EXISTS`, so a second run is a no-op.

ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'quote_declined';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'enquiry_nudged';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'enquiry_closing';
