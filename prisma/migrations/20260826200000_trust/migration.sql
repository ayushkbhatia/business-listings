-- Handoff 4, step 3. Trust: the visit report, PDPL requests, API keys.
--
-- Everything here is evidence about a supplier or about us. The verification
-- tier rests on the first, the law rests on the second, and the third is the
-- only way anything outside this codebase can read our data.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The visit report
--
-- `SiteVisitRequest` is the seller asking. This is what the field officer found,
-- and it is what licenses the tier change: lib/auth/subject.ts lets a field
-- verifier set a tier only for a visit they recorded, and `Business.visitedAt`
-- is a date with nothing behind it until this table exists.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "site_visit_report" (
  "id"          TEXT NOT NULL,
  "request_id"  TEXT,
  "business_id" TEXT NOT NULL,
  "staff_id"    UUID NOT NULL,
  "visited_at"  TIMESTAMP(3) NOT NULL,
  -- The three checks board 12h names. Each is a fact somebody stood in front of.
  "premises_found"  BOOLEAN NOT NULL,
  "signage_matches" BOOLEAN NOT NULL,
  "stock_present"   BOOLEAN NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "site_visit_report_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "site_visit_report"
  ADD CONSTRAINT "site_visit_report_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "site_visit_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "site_visit_report"
  ADD CONSTRAINT "site_visit_report_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: a report is evidence, and evidence whose author has been deleted is
-- not evidence. Staff accounts are deactivated rather than removed.
ALTER TABLE "site_visit_report"
  ADD CONSTRAINT "site_visit_report_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "site_visit_report_business_idx"
  ON "site_visit_report" ("business_id", "visited_at" DESC);

/*
 * The two geotagged photographs board 12h requires.
 *
 * A separate table rather than two columns, because "two" is a floor and not a
 * shape — a warehouse with three entrances gets three — and because each photo
 * carries its own coordinates. Coordinates are NOT NULL: a photograph without
 * them is a photograph of somewhere, and the whole point is that it is a
 * photograph of *there*.
 */
CREATE TABLE "site_visit_photo" (
  "id"        TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "media_id"  TEXT NOT NULL,
  "lat"       DOUBLE PRECISION NOT NULL,
  "lng"       DOUBLE PRECISION NOT NULL,
  "taken_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "site_visit_photo_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "site_visit_photo"
  ADD CONSTRAINT "site_visit_photo_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "site_visit_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_visit_photo"
  ADD CONSTRAINT "site_visit_photo_media_id_fkey"
  FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "site_visit_photo"
  ADD CONSTRAINT "site_visit_photo_is_in_the_uae"
  CHECK ("lat" BETWEEN 22 AND 27 AND "lng" BETWEEN 51 AND 57);

CREATE INDEX IF NOT EXISTS "site_visit_photo_report_idx" ON "site_visit_photo" ("report_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PDPL requests
--
-- A person asking what we hold about them, or asking us to delete it. The due
-- date is the law's, not ours, and it is stored rather than computed so a
-- change to the window does not silently reopen closed requests.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "pdpl_kind" AS ENUM ('access', 'erasure', 'correction');
CREATE TYPE "pdpl_state" AS ENUM ('received', 'in_progress', 'fulfilled', 'refused');

CREATE TABLE "pdpl_request" (
  "id"          TEXT NOT NULL,
  "kind"        "pdpl_kind" NOT NULL,
  "state"       "pdpl_state" NOT NULL DEFAULT 'received',
  -- The subject, where we can identify them. A request can arrive by email from
  -- somebody whose account we cannot find, and refusing to record it because
  -- the FK will not resolve is how a legal deadline gets missed.
  "subject_user_id" UUID,
  "subject_email"   TEXT,
  "subject_phone"   TEXT,
  "detail"      TEXT NOT NULL,
  "due_at"      TIMESTAMP(3) NOT NULL,
  "closed_at"   TIMESTAMP(3),
  "closed_by_id" UUID,
  -- NOT NULL once closed. A refusal in particular has to say why.
  "outcome_reason" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pdpl_request_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pdpl_request"
  ADD CONSTRAINT "pdpl_request_subject_user_id_fkey"
  FOREIGN KEY ("subject_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pdpl_request"
  ADD CONSTRAINT "pdpl_request_closed_by_id_fkey"
  FOREIGN KEY ("closed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pdpl_request"
  ADD CONSTRAINT "pdpl_request_closure_has_a_reason"
  CHECK (
    ("state" IN ('received', 'in_progress') AND "closed_at" IS NULL AND "outcome_reason" IS NULL)
    OR
    ("state" IN ('fulfilled', 'refused') AND "closed_at" IS NOT NULL AND "outcome_reason" IS NOT NULL)
  );

-- Somebody has to be identifiable, or there is nobody to answer.
ALTER TABLE "pdpl_request"
  ADD CONSTRAINT "pdpl_request_names_a_subject"
  CHECK (
    "subject_user_id" IS NOT NULL OR "subject_email" IS NOT NULL OR "subject_phone" IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS "pdpl_request_open_due_idx"
  ON "pdpl_request" ("due_at") WHERE "closed_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. API keys
--
-- The only way anything outside this codebase reads our data.
--
-- The secret is never stored. A hash is, and the plaintext is shown once at
-- issue and never again — a key we can read is a key that leaks with a database
-- dump, and "we can resend it" is the reason every key ends up in an email.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "api_key" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  -- The first characters, shown so somebody can tell two keys apart.
  "prefix"      TEXT NOT NULL,
  "secret_hash" TEXT NOT NULL,
  -- What it may read. An empty list is a key that can do nothing, which is a
  -- safer default than one that can do everything.
  "scopes"      TEXT[] NOT NULL DEFAULT '{}',
  "created_by_id" UUID NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "expires_at"  TIMESTAMP(3),
  "revoked_at"  TIMESTAMP(3),
  "revoke_reason" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "api_key"
  ADD CONSTRAINT "api_key_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "api_key"
  ADD CONSTRAINT "api_key_revocation_has_a_reason"
  CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS "api_key_secret_hash_key" ON "api_key" ("secret_hash");
CREATE INDEX IF NOT EXISTS "api_key_live_idx" ON "api_key" ("revoked_at") WHERE "revoked_at" IS NULL;
