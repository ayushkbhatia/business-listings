-- Board `1o` — the message to a supplier whose quote was accepted in part.
--
--  * `quote_partly_accepted` — the buyer accepted some of this supplier's lines
--    and took the rest from other suppliers, in one decision (D3). It names the
--    lines and their amount, and nothing about who supplies the rest (AC3).
--
-- On its own, because Postgres refuses to use an enum value in the transaction
-- that added it; the templates that cast to it are in
-- `20261116091000_accept_across_suppliers_templates_1o`.
--
-- ## Ordering
--
-- **Additive, and applies before the merge.** A value no row carries is
-- invisible to the deployed client (`docs/deployments.md` § Ordering).
--
-- Idempotent: `IF NOT EXISTS`, so a second run is a no-op.

ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'quote_partly_accepted';
