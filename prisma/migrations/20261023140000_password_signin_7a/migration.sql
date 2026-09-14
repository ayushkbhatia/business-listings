-- Board 7a — auth, four states, and mobile as the primary identity.
--
-- A password that can be used, a reset link that lasts the hour the screen
-- promises, a password lockout that leaves the code path open, and a record of
-- which terms somebody accepted.
--
-- Additive only, and it applies before the merge. The running deployment writes
-- none of these objects, and nothing here constrains a row it does write:
--
--   - one enum value (`password_verify`) the running code never selects,
--   - one nullable column on `user`,
--   - one index on `auth_attempt`,
--   - two new tables.
--
-- Idempotent throughout, so a second apply is a no-op rather than a failure.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The password lockout is its own kind of attempt (B5)
-- ─────────────────────────────────────────────────────────────────────────────

-- Never `otp_verify`. The lockout screen offers a code as the way through, so a
-- run of wrong passwords must not spend the code path's attempts.
ALTER TYPE "auth_attempt_kind" ADD VALUE IF NOT EXISTS 'password_verify';

-- The per-address ceiling. A per-identifier lockout does nothing against one
-- address trying one password across many accounts.
CREATE INDEX IF NOT EXISTS "auth_attempt_ip_kind_created_at_idx"
  ON "auth_attempt" ("ip", "kind", "created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Whether a password exists at all (B3)
-- ─────────────────────────────────────────────────────────────────────────────

-- Null for the ordinary account, which signs in with a code and never sets one.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "password_set_at" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reset grants (B2, B6)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "password_reset_channel" AS ENUM ('email', 'sms');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "password_reset" (
  "id"         TEXT NOT NULL,
  "user_id"    UUID NOT NULL,
  "channel"    "password_reset_channel" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at"    TIMESTAMP(3),
  "ip"         TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_token_hash_key"
  ON "password_reset" ("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_user_id_created_at_idx"
  ON "password_reset" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "password_reset_expires_at_idx"
  ON "password_reset" ("expires_at");

-- A grant is used after it was issued and before it ran out. An update that
-- stamped `used_at` on an expired row would be a reset the screen had refused.
ALTER TABLE "password_reset" DROP CONSTRAINT IF EXISTS "password_reset_used_in_window";
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_used_in_window"
  CHECK ("used_at" IS NULL OR ("used_at" >= "created_at" AND "used_at" <= "expires_at"));

-- No grant outlives an hour. The screen says "reset links last one hour", and
-- this is the half of that sentence the service cannot quietly change.
ALTER TABLE "password_reset" DROP CONSTRAINT IF EXISTS "password_reset_at_most_an_hour";
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_at_most_an_hour"
  CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + INTERVAL '1 hour');

DO $$ BEGIN
  ALTER TABLE "password_reset"
    ADD CONSTRAINT "password_reset_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "password_reset" ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Terms acceptance, with a version and a timestamp (B10)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "terms_acceptance" (
  "id"              TEXT NOT NULL,
  "user_id"         UUID NOT NULL,
  "terms_version"   TEXT NOT NULL,
  "privacy_version" TEXT NOT NULL,
  "accepted_at"     TIMESTAMP(3) NOT NULL,
  "source"          TEXT NOT NULL DEFAULT 'signup',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "terms_acceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "terms_acceptance_user_id_terms_version_privacy_version_key"
  ON "terms_acceptance" ("user_id", "terms_version", "privacy_version");
CREATE INDEX IF NOT EXISTS "terms_acceptance_user_id_accepted_at_idx"
  ON "terms_acceptance" ("user_id", "accepted_at");

-- A version is the document's effective date, as the page prints it. Anything
-- else — "v2", "latest", an empty string — is a record nobody can match to a
-- wording.
ALTER TABLE "terms_acceptance" DROP CONSTRAINT IF EXISTS "terms_acceptance_versions_are_dates";
ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_versions_are_dates"
  CHECK ("terms_version" ~ '^\d{4}-\d{2}-\d{2}$' AND "privacy_version" ~ '^\d{4}-\d{2}-\d{2}$');

DO $$ BEGIN
  ALTER TABLE "terms_acceptance"
    ADD CONSTRAINT "terms_acceptance_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "terms_acceptance" ENABLE ROW LEVEL SECURITY;
