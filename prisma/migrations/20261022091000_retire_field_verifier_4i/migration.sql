-- Board 4i `B1` and `B9` — the field verifier is retired, and retired means removed.
--
-- The 5 Sep 2026 site-visit cut (decision 6) withdrew the role's only remaining
-- grant. The permissions document was updated that day; the enum was not, which
-- left `staff_field` a valid value any later migration or seed could grant.
--
-- Two steps, in this order, in one transaction:
--
--   1. Holders are moved first (B9). Board 4i Q1 answers where: to moderator —
--      "the work was verification-adjacent and moderation is where it landed".
--      Their existing audit rows are untouched; `audit_event` is append-only and
--      keys on the person, not on the role they held.
--
--      No audit row is written for the move. `audit_event.actor_id` is NOT NULL
--      because the log records decisions and who made them, and a migration has
--      no actor to name — the same call the licence-expiry sweep makes, and the
--      reason CLAUDE.md gives for not inventing one. This file, and the PR that
--      carries it, are the record.
--
--   2. The type is rebuilt without the value. Postgres cannot drop an enum
--      label, so the columns move to a new type and the old one is dropped.
--
-- Safe before the merge: the code on `main` never writes `staff_field` outside
-- the local seed and the loopback-only dev seat, and an older Prisma client reads
-- a value set that has lost a label without complaint.

-- ── 1 · Move the holders ────────────────────────────────────────────────────

UPDATE "user"
SET "roles" = array(
  SELECT DISTINCT r FROM unnest(array_replace("roles", 'staff_field'::"role", 'staff_moderator'::"role")) AS r
  ORDER BY r
)
WHERE 'staff_field'::"role" = ANY ("roles");

-- A seller invitation never offered it, and the accept path filters to seller
-- roles regardless; removed so the cast below cannot fail on a stray row.
UPDATE "team_invite"
SET "roles" = array_remove("roles", 'staff_field'::"role")
WHERE 'staff_field'::"role" = ANY ("roles");

-- ── 2 · Rebuild the type ────────────────────────────────────────────────────

CREATE TYPE "role_new" AS ENUM (
  'buyer',
  'seller_owner',
  'seller_manager',
  'seller_sales',
  'seller_finance',
  'staff_moderator',
  'staff_finance',
  'staff_ops_lead'
);

ALTER TABLE "user" ALTER COLUMN "roles" DROP DEFAULT;
ALTER TABLE "team_invite" ALTER COLUMN "roles" DROP DEFAULT;

ALTER TABLE "user" ALTER COLUMN "roles" TYPE "role_new"[] USING ("roles"::text[]::"role_new"[]);
ALTER TABLE "team_invite" ALTER COLUMN "roles" TYPE "role_new"[] USING ("roles"::text[]::"role_new"[]);
ALTER TABLE "staff_invite" ALTER COLUMN "role" TYPE "role_new" USING ("role"::text::"role_new");

ALTER TYPE "role" RENAME TO "role_old";
ALTER TYPE "role_new" RENAME TO "role";
DROP TYPE "role_old";

ALTER TABLE "user" ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"role"[];
ALTER TABLE "team_invite" ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"role"[];
