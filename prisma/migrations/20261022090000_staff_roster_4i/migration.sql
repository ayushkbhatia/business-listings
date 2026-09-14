-- Board 4i — staff, roles and the audit log.
--
-- Additive. Nothing here is read by the code on `main`, so it applies before the
-- merge that reads it (docs/deployments.md § Ordering). The role retirement is a
-- separate migration, 20261022091000_retire_field_verifier_4i, because it
-- rewrites a type rather than adding to one.

-- ── 1 · Who is staff, and when they last used the console ───────────────────

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "staff_last_active_at" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "staff_deactivated_at" TIMESTAMP(3);

-- `roles && ARRAY[staff roles]` is the roster's one question, asked over every
-- account on the platform. Named as Prisma names it, so `migrate dev` reads it
-- as the `@@index([roles], type: Gin)` it is rather than as drift to drop.
CREATE INDEX IF NOT EXISTS "user_roles_idx" ON "user" USING GIN ("roles");

-- ── 2 · Staff invitations ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "staff_invite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_sent_at" TIMESTAMP(3) NOT NULL,
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_invite_token_hash_key" ON "staff_invite"("token_hash");
CREATE INDEX IF NOT EXISTS "staff_invite_email_idx" ON "staff_invite"("email");
CREATE INDEX IF NOT EXISTS "staff_invite_created_at_id_idx" ON "staff_invite"("created_at", "id");

-- One outstanding invitation per address. An expired one is still outstanding —
-- it is resent, not stacked — so the condition is acceptance and revocation only.
CREATE UNIQUE INDEX IF NOT EXISTS "staff_invite_one_outstanding_per_email"
  ON "staff_invite"("email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

DO $$ BEGIN
  ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_accepted_by_id_fkey"
    FOREIGN KEY ("accepted_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A staff invitation offers a staff role and nothing else. Named in text rather
-- than as enum literals so it survives the enum being rebuilt without
-- `staff_field` in the next migration.
DO $$ BEGIN
  ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_role_is_staff"
    CHECK ("role"::text IN ('staff_moderator', 'staff_finance', 'staff_ops_lead'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_email_normalised"
    CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Accepted and revoked are exclusive, and acceptance names who accepted.
DO $$ BEGIN
  ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_one_outcome"
    CHECK (NOT ("accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL)
       AND ("accepted_at" IS NULL) = ("accepted_by_id" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3 · Blast radius on the audit log (B4) ──────────────────────────────────

ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "blast_radius" INTEGER;
ALTER TABLE "audit_event" ADD COLUMN IF NOT EXISTS "blast_unit" TEXT;

DO $$ BEGIN
  ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_blast_radius_has_unit"
    CHECK (("blast_radius" IS NULL) = ("blast_unit" IS NULL)
       AND ("blast_radius" IS NULL OR "blast_radius" >= 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4 · The log is append-only (B6, acceptance criterion 6) ─────────────────
--
-- A trigger, because "no screen offers an edit" is a statement about screens.
-- Any path to the table — a script, a service written next year, a console
-- session — is refused an UPDATE outright. A DELETE is refused unless the
-- session has set `app.audit_maintenance` to `on`, which only integration-test
-- cleanup does, by name, inside one transaction (tests/integration/audit-cleanup.ts).
-- TRUNCATE is not a row event and is not guarded: the only caller is the local
-- seed, which `assertLocalTarget` refuses against any non-loopback database.

CREATE OR REPLACE FUNCTION "audit_event_append_only"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_maintenance', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_event is append-only; % of % refused', TG_OP, OLD."id"
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS "audit_event_append_only" ON "audit_event";
CREATE TRIGGER "audit_event_append_only"
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_append_only"();
