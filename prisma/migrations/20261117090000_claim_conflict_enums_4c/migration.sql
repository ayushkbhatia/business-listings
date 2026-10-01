-- Board `4c` — review a submission, the conflicting-claim body. The enum values
-- the rest of the board casts to, on their own because Postgres refuses to use
-- an enum value in the transaction that added it.
--
--  * `notification_event` — five claim messages (`B3`). `2a` and `2b` promise
--    both claimants a decision within 48 hours and that they are told when a
--    conflict opens; none of the keys that existed anywhere was a claim
--    message, so nothing was ever sent.
--  * `claim_resolution` — `award` names the winning claim in
--    `awarded_submission_id` rather than by its position (`award_to_a` /
--    `award_to_b` assumed exactly two sides), and `keep_owner` is how a
--    challenge to a listing that already has an owner ends with the owner
--    keeping it (§Flagged 2).
--  * `document_kind` — `tenancy_contract`, the document an ops lead asks every
--    side for (Q4, `D-DOCS`).
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- Values nothing deployed reads, writes or sends. The templates that cast to
-- the new events are in `20261117091000_claim_templates_4c`, which applies
-- last, seconds before the merge (rows carrying an unknown enum value break the
-- deployed client's read).
--
-- Idempotent: `IF NOT EXISTS`, so a second run is a no-op.

ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'claim_conflict_opened';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'claim_awarded';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'claim_not_awarded';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'claim_documents_requested';
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'claim_new_listing_created';

ALTER TYPE "claim_resolution" ADD VALUE IF NOT EXISTS 'award';
ALTER TYPE "claim_resolution" ADD VALUE IF NOT EXISTS 'keep_owner';

ALTER TYPE "document_kind" ADD VALUE IF NOT EXISTS 'tenancy_contract';
