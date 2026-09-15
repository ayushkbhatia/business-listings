-- Board `1d` amendment — the contact reveal, in place, behind a three-field form.
--
-- 1. `contact_lead`. The name, work email and mobile a buyer gives to see a
--    supplier's landline. One per (listing, visitor): the form gates once per
--    visitor and listing, never once per reveal (`B10`). The seller reads these
--    on `/dashboard/leads/phone` and staff on `/admin/leads`.
--
-- 2. `contact_reveal` gains the session it happened in, the lead that unlocked
--    it and the page the buyer came from (`B1`, `B6`, `B9`). A unique index on
--    (session, listing, channel) makes a re-reveal in the same session the same
--    row, so the seller's reveal count cannot grow with reloads. Rows from
--    before the amendment carry no session, and NULLs never collide.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- The deployed code inserts `contact_reveal` rows without the three new columns,
-- which stay NULL, and never reads `contact_lead`.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

-- ── 1 · leads ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "contact_lead" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "visitor_id"  UUID NOT NULL,
  "actor_id"    UUID,
  "name"        TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "mobile"      TEXT NOT NULL,
  "source_path" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_lead_pkey" PRIMARY KEY ("id"),
  -- The form's own bounds, held where a second writer cannot skip them.
  CONSTRAINT "contact_lead_name_bounded" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120),
  CONSTRAINT "contact_lead_email_shape" CHECK (
    char_length("email") <= 254 AND "email" = lower("email") AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
  ),
  -- A UAE mobile in E.164. The form offers +971 and nothing else.
  CONSTRAINT "contact_lead_mobile_e164" CHECK ("mobile" ~ '^\+9715[0-9]{8}$'),
  -- A path inside the platform, never a URL with somebody else's host in it.
  CONSTRAINT "contact_lead_source_is_a_path" CHECK (
    "source_path" IS NULL OR ("source_path" LIKE '/%' AND char_length("source_path") <= 500)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_lead_business_id_visitor_id_key"
  ON "contact_lead" ("business_id", "visitor_id");
CREATE INDEX IF NOT EXISTS "contact_lead_business_id_created_at_id_idx"
  ON "contact_lead" ("business_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "contact_lead_business_id_actor_id_idx"
  ON "contact_lead" ("business_id", "actor_id");
CREATE INDEX IF NOT EXISTS "contact_lead_visitor_id_created_at_idx"
  ON "contact_lead" ("visitor_id", "created_at");
CREATE INDEX IF NOT EXISTS "contact_lead_created_at_id_idx"
  ON "contact_lead" ("created_at", "id");

DO $$
BEGIN
  ALTER TABLE "contact_lead"
    ADD CONSTRAINT "contact_lead_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "contact_lead"
    ADD CONSTRAINT "contact_lead_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Personal data. Zero policies, as every table here: nothing reads it through
-- PostgREST.
ALTER TABLE "contact_lead" ENABLE ROW LEVEL SECURITY;

-- ── 2 · the reveal's session, lead and source ───────────────────────────────

ALTER TABLE "contact_reveal" ADD COLUMN IF NOT EXISTS "session_id" TEXT;
ALTER TABLE "contact_reveal" ADD COLUMN IF NOT EXISTS "lead_id" TEXT;
ALTER TABLE "contact_reveal" ADD COLUMN IF NOT EXISTS "source_path" TEXT;

DO $$
BEGIN
  ALTER TABLE "contact_reveal"
    ADD CONSTRAINT "contact_reveal_source_is_a_path" CHECK (
      "source_path" IS NULL OR ("source_path" LIKE '/%' AND char_length("source_path") <= 500)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "contact_reveal_session_id_business_id_channel_key"
  ON "contact_reveal" ("session_id", "business_id", "channel");
CREATE INDEX IF NOT EXISTS "contact_reveal_lead_id_idx" ON "contact_reveal" ("lead_id");

DO $$
BEGIN
  ALTER TABLE "contact_reveal"
    ADD CONSTRAINT "contact_reveal_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "contact_lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
