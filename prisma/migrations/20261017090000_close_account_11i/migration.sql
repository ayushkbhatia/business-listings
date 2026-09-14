-- Board 11i — closing an account.
--
-- Closure is a status transition, never a delete. The business row survives as
-- the anchor every retained enquiry, quote and review hangs from, and the slug
-- stays on it for good — which is what reserves the URL.
--
-- Additive only. Two nullable columns on `business`, two enums, one table, and
-- the invariants Prisma cannot express. Nothing rewrites an existing row.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Where the listing is now
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "closure_requested_at" TIMESTAMP(3);
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);

-- A final closure was requested first. `closed_at` without
-- `closure_requested_at` would be a business that became final without ever
-- coming down, which no path writes and no reader could explain.
ALTER TABLE "business" DROP CONSTRAINT IF EXISTS "business_closed_after_requested";
ALTER TABLE "business" ADD CONSTRAINT "business_closed_after_requested"
  CHECK ("closed_at" IS NULL OR "closure_requested_at" IS NOT NULL);

-- A business under closure is not published. The nulling of `published_at` is
-- what takes it out of every public read, so the two must never disagree: a
-- published row with a closure against it is a listing buyers can still find,
-- which is build note B2 failing silently.
ALTER TABLE "business" DROP CONSTRAINT IF EXISTS "business_closure_unpublishes";
ALTER TABLE "business" ADD CONSTRAINT "business_closure_unpublishes"
  CHECK ("closure_requested_at" IS NULL OR "published_at" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. How it got there
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "closure_initiator" AS ENUM ('owner', 'platform');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "closure_reversal" AS ENUM ('email', 'dashboard', 'licence_renewed', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "business_closure" (
  "id"                  TEXT NOT NULL,
  "business_id"         TEXT NOT NULL,
  "initiator"           "closure_initiator" NOT NULL,
  "requested_by_id"     UUID NOT NULL,
  "owner_id"            UUID,
  "requested_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effective_at"        TIMESTAMP(3) NOT NULL,
  "applied_at"          TIMESTAMP(3),
  "final_at"            TIMESTAMP(3) NOT NULL,
  "reversed_at"         TIMESTAMP(3),
  "reversed_by_id"      UUID,
  "reversed_via"        "closure_reversal",
  "finalised_at"        TIMESTAMP(3),
  "token_hash"          TEXT NOT NULL,
  "snapshot"            JSONB NOT NULL DEFAULT '{}',
  "email_delivered_at"  TIMESTAMP(3),
  "documents_purged_at" TIMESTAMP(3),
  CONSTRAINT "business_closure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_closure_token_hash_key"
  ON "business_closure" ("token_hash");
CREATE INDEX IF NOT EXISTS "business_closure_business_id_requested_at_idx"
  ON "business_closure" ("business_id", "requested_at");
CREATE INDEX IF NOT EXISTS "business_closure_owner_id_idx"
  ON "business_closure" ("owner_id");
CREATE INDEX IF NOT EXISTS "business_closure_effective_at_idx"
  ON "business_closure" ("effective_at");
CREATE INDEX IF NOT EXISTS "business_closure_final_at_idx"
  ON "business_closure" ("final_at");

-- Restrict, not cascade. A closure is the record of a business leaving the
-- directory; nothing should be able to delete the business out from under it.
DO $$ BEGIN
  ALTER TABLE "business_closure"
    ADD CONSTRAINT "business_closure_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "business_closure"
    ADD CONSTRAINT "business_closure_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "business_closure"
    ADD CONSTRAINT "business_closure_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "business_closure"
    ADD CONSTRAINT "business_closure_reversed_by_id_fkey"
    FOREIGN KEY ("reversed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One open closure per business.
--
-- Open means neither reversed nor final. Two tabs pressing "Request closure" at
-- once must not produce two windows with two final dates and two tokens, and a
-- plain unique index on `business_id` would forbid the second, legitimate
-- closure of a business that was reopened and later closed again. Prisma cannot
-- express the predicate, so it lives here and `pnpm check:schema` asserts it.
CREATE UNIQUE INDEX IF NOT EXISTS "business_closure_one_open"
  ON "business_closure" ("business_id")
  WHERE "reversed_at" IS NULL AND "finalised_at" IS NULL;

-- A closure ends one way. Reversed and final are exclusive, and a reversal
-- always says by which door.
ALTER TABLE "business_closure" DROP CONSTRAINT IF EXISTS "business_closure_ends_once";
ALTER TABLE "business_closure" ADD CONSTRAINT "business_closure_ends_once"
  CHECK ("reversed_at" IS NULL OR "finalised_at" IS NULL);

ALTER TABLE "business_closure" DROP CONSTRAINT IF EXISTS "business_closure_reversal_says_how";
ALTER TABLE "business_closure" ADD CONSTRAINT "business_closure_reversal_says_how"
  CHECK (("reversed_at" IS NULL) = ("reversed_via" IS NULL));

-- The window runs forward. A final date on or before the date the listing came
-- down is a closure nobody could ever have reversed.
ALTER TABLE "business_closure" DROP CONSTRAINT IF EXISTS "business_closure_window_runs_forward";
ALTER TABLE "business_closure" ADD CONSTRAINT "business_closure_window_runs_forward"
  CHECK ("final_at" > "effective_at" AND "effective_at" >= "requested_at");

-- An owner closure takes effect the moment it is asked for. Only a platform
-- closure has a notice period — build note B8.
ALTER TABLE "business_closure" DROP CONSTRAINT IF EXISTS "business_closure_owner_is_immediate";
ALTER TABLE "business_closure" ADD CONSTRAINT "business_closure_owner_is_immediate"
  CHECK ("initiator" <> 'owner' OR "effective_at" = "requested_at");

-- PostgREST lockdown: RLS on with no policies, like every application table.
ALTER TABLE "business_closure" ENABLE ROW LEVEL SECURITY;
