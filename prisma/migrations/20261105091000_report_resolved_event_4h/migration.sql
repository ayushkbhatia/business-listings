-- Board `4h` `Q5` — a notification event for the answer to a report.
--
-- On its own, and that is not tidiness. Postgres refuses to *use* an enum value
-- in the transaction that added it, and `prisma migrate deploy` runs each file
-- in one — so the `INSERT` that writes the two templates cannot sit beside the
-- `ALTER TYPE` that makes the value it casts to. The templates are in
-- `20261105092000_report_resolved_templates_4h`, which applies after this.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- An enum value nothing yet writes. The deployed code neither reads nor sends it.
--
-- Idempotent: `IF NOT EXISTS`, so a second run is a no-op.

ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'report_resolved';
