-- Board `7b` — three notification events for the buying company.
--
--  * `approval_requested` — to everybody the rule allows to approve a request.
--  * `approval_decided`   — to the person who raised it: approved, or queried.
--  * `off_platform_flagged` — to the company's admins, when the message scanner
--    flags a supplier asking to be paid outside the platform (`B4`).
--
-- On their own, because Postgres refuses to use an enum value in the
-- transaction that added it; the templates that cast to them are in
-- `20261108091000_buyer_company_templates_7b`, which applies after this.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- Values nothing deployed reads or sends.
--
-- Idempotent: `IF NOT EXISTS`, so a second run is a no-op.

ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'approval_requested';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'approval_decided';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'off_platform_flagged';
