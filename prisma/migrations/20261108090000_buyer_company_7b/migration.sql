-- Board `7b` — the buying company: its details, its delivery addresses, a team
-- with spend authority, one approval rule, and a history of its own.
--
-- `buyer_company` has existed since the init migration with a TRN, an emirate
-- and an `approval_threshold_aed` that nothing read, and `user.buyer_company_id`
-- with no writer outside the seed. This is the writer, and the gate the
-- threshold was always meant to be.
--
-- ## What it adds
--
--  1. **The company's own fields** — licence number, accounts email, the named
--     approver and four rule flags. `B2`: the rule card renders from these and
--     from nothing else.
--  2. **`buyer_company_member`** — the record of who buys for whom, in which
--     role, under which monthly limit (`B5`). Deactivated, never deleted
--     (flag 7). `user.buyer_company_id` becomes its mirror: a trigger on this
--     table writes it, and a trigger on `user` refuses a direct write that
--     disagrees. One source, held by the database, not by every future writer
--     remembering.
--  3. **`buyer_company_invite`** — `B11`, *Invited* as a state that expires.
--     Hashed token, one outstanding invitation per address.
--  4. **`buyer_delivery_address`** — `B6`, structured constraints: access hours,
--     access point, load limit, attn. contact. One default, by partial index.
--  5. **`quote_approval`** — `B1`/`B3`, a quote held for a colleague's approval
--     instead of accepted. One open request per enquiry, by partial index. The
--     request's snapshot — quote, revision, value, reasons, raiser — is fixed
--     at insert, and a decided request stays decided, by trigger.
--  6. **`buyer_company_event`** — `B8`, the company's history, append-only by
--     trigger.
--  7. **On `enquiry`**: the delivery address and its snapshot, and the cost code
--     written with an acceptance.
--
-- ## Backfill
--
-- Every user already pointing at a company becomes its `company_admin` — they
-- are each the only member of their company, on production and in every seed.
-- A company with a threshold gets its earliest member as the named approver.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- The deployed code never writes `user.buyer_company_id` (the guard's only
-- target), never reads the new columns, and inserts enquiries without them —
-- every new column is nullable or defaulted.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

-- ── 1 · Types ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "buyer_company_role" AS ENUM ('company_admin', 'procurement', 'requester');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "delivery_load_limit" AS ENUM ('small_parcels', 'pallets', 'full_loads');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "approval_reason" AS ENUM ('over_threshold', 'over_limit', 'no_authority', 'unverified_supplier', 'no_total');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "quote_approval_status" AS ENUM ('pending', 'approved', 'queried', 'withdrawn', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "buyer_company_event_kind" AS ENUM (
    'company_created', 'details_changed',
    'address_added', 'address_changed', 'address_archived', 'default_address_changed',
    'member_invited', 'invite_resent', 'invite_revoked', 'member_joined', 'member_changed', 'member_deactivated',
    'rule_changed',
    'approval_requested', 'approval_approved', 'approval_queried', 'approval_answered', 'approval_withdrawn',
    'quote_accepted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2 · The company's own fields ─────────────────────────────────────────────

ALTER TABLE "buyer_company"
  ADD COLUMN IF NOT EXISTS "licence_number" TEXT,
  ADD COLUMN IF NOT EXISTS "accounts_email" TEXT,
  ADD COLUMN IF NOT EXISTS "approver_id" UUID,
  ADD COLUMN IF NOT EXISTS "require_po_number" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "require_cost_code" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "unverified_needs_approval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tell_admins_off_platform" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$ BEGIN
  ALTER TABLE "buyer_company" ADD CONSTRAINT "buyer_company_approver_id_fkey"
    FOREIGN KEY ("approver_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "buyer_company_approver_id_idx" ON "buyer_company"("approver_id");

-- A TRN is fifteen digits and nothing else; spaces are a display concern.
DO $$ BEGIN
  ALTER TABLE "buyer_company" ADD CONSTRAINT "buyer_company_trn_digits"
    CHECK ("trn" IS NULL OR "trn" ~ '^[0-9]{15}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "buyer_company" ADD CONSTRAINT "buyer_company_name_present"
    CHECK (btrim("name") <> '' AND char_length("name") <= 160);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "buyer_company" ADD CONSTRAINT "buyer_company_licence_number_length"
    CHECK ("licence_number" IS NULL OR (btrim("licence_number") <> '' AND char_length("licence_number") <= 40));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "buyer_company" ADD CONSTRAINT "buyer_company_accounts_email_normalised"
    CHECK ("accounts_email" IS NULL OR ("accounts_email" = lower(btrim("accounts_email")) AND position('@' IN "accounts_email") > 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "buyer_company" ADD CONSTRAINT "buyer_company_threshold_positive"
    CHECK ("approval_threshold_aed" IS NULL OR "approval_threshold_aed" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3 · Membership ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "buyer_company_member" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "buyer_company_role" NOT NULL,
  "monthly_limit_aed" INTEGER,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invited_by_id" UUID,
  "deactivated_at" TIMESTAMP(3),
  "deactivated_by_id" UUID,
  CONSTRAINT "buyer_company_member_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "buyer_company_member_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "buyer_company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_member_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_member_deactivated_by_id_fkey" FOREIGN KEY ("deactivated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- `B5`: a procurement seat has a limit, and nobody else has one. An admin is
  -- unlimited and a requester commits nothing, so a number on either would be
  -- a figure the gate never reads.
  CONSTRAINT "buyer_company_member_limit_matches_role"
    CHECK (("role" = 'procurement') = ("monthly_limit_aed" IS NOT NULL)),
  CONSTRAINT "buyer_company_member_limit_positive"
    CHECK ("monthly_limit_aed" IS NULL OR "monthly_limit_aed" > 0)
);

CREATE INDEX IF NOT EXISTS "buyer_company_member_company_id_idx" ON "buyer_company_member"("company_id");
CREATE INDEX IF NOT EXISTS "buyer_company_member_user_id_idx" ON "buyer_company_member"("user_id");
-- One company at a time. `user.buyer_company_id` is a single column because a
-- person buys for one employer, and this is what makes that true.
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_company_member_one_active"
  ON "buyer_company_member"("user_id") WHERE "deactivated_at" IS NULL;

-- ── 4 · Invitations ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "buyer_company_invite" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "role" "buyer_company_role" NOT NULL,
  "monthly_limit_aed" INTEGER,
  "token_hash" TEXT NOT NULL,
  "invited_by_id" UUID,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "send_count" INTEGER NOT NULL DEFAULT 1,
  "accepted_at" TIMESTAMP(3),
  "accepted_by_id" UUID,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buyer_company_invite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "buyer_company_invite_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "buyer_company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_invite_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_invite_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_invite_email_normalised"
    CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1),
  CONSTRAINT "buyer_company_invite_name_present"
    CHECK (btrim("full_name") <> '' AND char_length("full_name") <= 120),
  CONSTRAINT "buyer_company_invite_limit_matches_role"
    CHECK (("role" = 'procurement') = ("monthly_limit_aed" IS NOT NULL)),
  CONSTRAINT "buyer_company_invite_limit_positive"
    CHECK ("monthly_limit_aed" IS NULL OR "monthly_limit_aed" > 0),
  CONSTRAINT "buyer_company_invite_one_outcome"
    CHECK (NOT ("accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "buyer_company_invite_token_hash_key" ON "buyer_company_invite"("token_hash");
CREATE INDEX IF NOT EXISTS "buyer_company_invite_company_id_idx" ON "buyer_company_invite"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_company_invite_one_outstanding"
  ON "buyer_company_invite"("company_id", "email") WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- ── 5 · Delivery addresses ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "buyer_delivery_address" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "address_line" TEXT NOT NULL,
  "emirate" "emirate" NOT NULL,
  "area_id" TEXT,
  "attn_name" TEXT,
  "attn_phone" TEXT,
  "access_point" TEXT,
  "access_from" INTEGER,
  "access_until" INTEGER,
  "load_limit" "delivery_load_limit",
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buyer_delivery_address_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "buyer_delivery_address_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "buyer_company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buyer_delivery_address_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "buyer_delivery_address_text_lengths" CHECK (
    btrim("label") <> '' AND char_length("label") <= 80
    AND btrim("address_line") <> '' AND char_length("address_line") <= 160
    AND ("attn_name" IS NULL OR (btrim("attn_name") <> '' AND char_length("attn_name") <= 80))
    AND ("access_point" IS NULL OR (btrim("access_point") <> '' AND char_length("access_point") <= 40))
  ),
  CONSTRAINT "buyer_delivery_address_attn_phone_e164"
    CHECK ("attn_phone" IS NULL OR "attn_phone" ~ '^\+[1-9][0-9]{7,14}$'),
  -- Minutes from midnight. An until of 1440 is "until midnight", a from of 0 is
  -- "from midnight", and a window that ends before it starts is a typo.
  CONSTRAINT "buyer_delivery_address_access_window" CHECK (
    ("access_from" IS NULL OR "access_from" BETWEEN 0 AND 1439)
    AND ("access_until" IS NULL OR "access_until" BETWEEN 1 AND 1440)
    AND ("access_from" IS NULL OR "access_until" IS NULL OR "access_from" < "access_until")
  ),
  CONSTRAINT "buyer_delivery_address_archived_not_default"
    CHECK (NOT ("is_default" AND "archived_at" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "buyer_delivery_address_company_id_idx" ON "buyer_delivery_address"("company_id");
CREATE INDEX IF NOT EXISTS "buyer_delivery_address_area_id_idx" ON "buyer_delivery_address"("area_id");
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_delivery_address_one_default"
  ON "buyer_delivery_address"("company_id") WHERE "is_default" AND "archived_at" IS NULL;

-- ── 6 · The enquiry side ─────────────────────────────────────────────────────

ALTER TABLE "enquiry"
  ADD COLUMN IF NOT EXISTS "cost_code" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_address_id" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_snapshot" JSONB;

DO $$ BEGIN
  ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_delivery_address_id_fkey"
    FOREIGN KEY ("delivery_address_id") REFERENCES "buyer_delivery_address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_cost_code_length"
    CHECK ("cost_code" IS NULL OR (btrim("cost_code") <> '' AND char_length("cost_code") <= 40));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "enquiry_delivery_address_id_idx" ON "enquiry"("delivery_address_id");
-- The spend read: a company's acceptances in a Dubai month.
CREATE INDEX IF NOT EXISTS "enquiry_buyer_company_id_contact_released_at_idx"
  ON "enquiry"("buyer_company_id", "contact_released_at");

-- ── 7 · Approvals ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "quote_approval" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "enquiry_id" TEXT NOT NULL,
  "quote_id" TEXT NOT NULL,
  "quote_revision" INTEGER NOT NULL,
  "value_fils" BIGINT,
  "raised_by_id" UUID NOT NULL,
  "reasons" "approval_reason"[] NOT NULL,
  "approver_id" UUID,
  "po_number" TEXT,
  "cost_code" TEXT,
  "note" TEXT,
  "status" "quote_approval_status" NOT NULL DEFAULT 'pending',
  "decided_by_id" UUID,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "answer" TEXT,
  "answered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_approval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_approval_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "buyer_company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_approval_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_approval_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_approval_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_approval_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quote_approval_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- A request with no reason is a quote that could have been accepted.
  CONSTRAINT "quote_approval_has_reason" CHECK (cardinality("reasons") > 0),
  CONSTRAINT "quote_approval_value_not_negative" CHECK ("value_fils" IS NULL OR "value_fils" >= 0),
  CONSTRAINT "quote_approval_text_lengths" CHECK (
    ("po_number" IS NULL OR (btrim("po_number") <> '' AND char_length("po_number") <= 40))
    AND ("cost_code" IS NULL OR (btrim("cost_code") <> '' AND char_length("cost_code") <= 40))
    AND ("note" IS NULL OR char_length("note") <= 1000)
    AND ("decision_note" IS NULL OR char_length("decision_note") <= 1000)
    AND ("answer" IS NULL OR char_length("answer") <= 1000)
  ),
  -- A query is a question, and a question has words.
  CONSTRAINT "quote_approval_query_has_note"
    CHECK ("status" <> 'queried' OR ("decision_note" IS NOT NULL AND btrim("decision_note") <> '')),
  -- Decided means dated. Not "decided by": that is `SET NULL` on the person's
  -- deletion, and a CHECK requiring it would refuse the deletion (board 4h).
  CONSTRAINT "quote_approval_decided_dated"
    CHECK ("status" NOT IN ('approved', 'queried') OR "decided_at" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "quote_approval_company_id_status_idx" ON "quote_approval"("company_id", "status");
CREATE INDEX IF NOT EXISTS "quote_approval_enquiry_id_idx" ON "quote_approval"("enquiry_id");
CREATE INDEX IF NOT EXISTS "quote_approval_quote_id_idx" ON "quote_approval"("quote_id");
CREATE INDEX IF NOT EXISTS "quote_approval_raised_by_id_idx" ON "quote_approval"("raised_by_id");
CREATE INDEX IF NOT EXISTS "quote_approval_decided_by_id_decided_at_idx" ON "quote_approval"("decided_by_id", "decided_at");
-- One open request per enquiry: an enquiry is accepted once, so it is asked
-- about once at a time. A new request supersedes the old one in the service.
CREATE UNIQUE INDEX IF NOT EXISTS "quote_approval_one_open"
  ON "quote_approval"("enquiry_id") WHERE "status" IN ('pending', 'queried');

-- ── 8 · History ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "buyer_company_event" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "actor_id" UUID,
  "actor_name" TEXT NOT NULL,
  "kind" "buyer_company_event_kind" NOT NULL,
  "subject" TEXT,
  "before" JSONB,
  "after" JSONB,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buyer_company_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "buyer_company_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "buyer_company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "buyer_company_event_actor_named" CHECK (btrim("actor_name") <> '')
);

CREATE INDEX IF NOT EXISTS "buyer_company_event_company_id_created_at_idx"
  ON "buyer_company_event"("company_id", "created_at");

-- ── 9 · Backfill ─────────────────────────────────────────────────────────────

INSERT INTO "buyer_company_member" ("id", "company_id", "user_id", "role", "joined_at")
SELECT gen_random_uuid()::text, u."buyer_company_id", u."id", 'company_admin', u."created_at"
  FROM "user" AS u
 WHERE u."buyer_company_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "buyer_company_member" AS m
      WHERE m."user_id" = u."id" AND m."deactivated_at" IS NULL
   );

UPDATE "buyer_company" AS c
   SET "approver_id" = (
     SELECT m."user_id" FROM "buyer_company_member" AS m
      WHERE m."company_id" = c."id" AND m."deactivated_at" IS NULL AND m."role" = 'company_admin'
      ORDER BY m."joined_at", m."id"
      LIMIT 1
   )
 WHERE c."approval_threshold_aed" IS NOT NULL
   AND c."approver_id" IS NULL;

-- ── 10 · The mirror, and its guard ───────────────────────────────────────────

-- `user.buyer_company_id` follows the active membership, whatever changed it:
-- an insert, a deactivation, a cascade from the company or the person.
CREATE OR REPLACE FUNCTION "buyer_company_member_mirror"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected UUID[];
  person UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected := ARRAY[OLD."user_id"];
  ELSIF TG_OP = 'UPDATE' THEN
    affected := ARRAY[OLD."user_id", NEW."user_id"];
  ELSE
    affected := ARRAY[NEW."user_id"];
  END IF;

  FOREACH person IN ARRAY affected LOOP
    UPDATE "user" AS u
       SET "buyer_company_id" = (
         SELECT m."company_id" FROM "buyer_company_member" AS m
          WHERE m."user_id" = person AND m."deactivated_at" IS NULL
          LIMIT 1
       )
     WHERE u."id" = person
       AND u."buyer_company_id" IS DISTINCT FROM (
         SELECT m."company_id" FROM "buyer_company_member" AS m
          WHERE m."user_id" = person AND m."deactivated_at" IS NULL
          LIMIT 1
       );
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "buyer_company_member_mirror" ON "buyer_company_member";
CREATE TRIGGER "buyer_company_member_mirror"
  AFTER INSERT OR UPDATE OR DELETE ON "buyer_company_member"
  FOR EACH ROW EXECUTE FUNCTION "buyer_company_member_mirror"();

-- A statement aimed at the column itself must agree with the membership. The
-- mirror above writes it one trigger level down, and so does the company's own
-- `ON DELETE SET NULL`; both pass.
CREATE OR REPLACE FUNCTION "user_buyer_company_follows_membership"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  expected TEXT;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."buyer_company_id" IS NOT DISTINCT FROM OLD."buyer_company_id" THEN
    RETURN NEW;
  END IF;
  SELECT m."company_id" INTO expected
    FROM "buyer_company_member" AS m
   WHERE m."user_id" = NEW."id" AND m."deactivated_at" IS NULL
   LIMIT 1;
  IF NEW."buyer_company_id" IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'user.buyer_company_id follows buyer_company_member; add or deactivate a membership instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "user_buyer_company_follows_membership" ON "user";
CREATE TRIGGER "user_buyer_company_follows_membership"
  BEFORE INSERT OR UPDATE OF "buyer_company_id" ON "user"
  FOR EACH ROW EXECUTE FUNCTION "user_buyer_company_follows_membership"();

-- ── 11 · A request is what was asked ─────────────────────────────────────────

-- The snapshot is fixed at insert; the status moves only forward; and a
-- decided, withdrawn or superseded request stays that way. The foreign keys'
-- own `SET NULL` still passes, one level down.
CREATE OR REPLACE FUNCTION "quote_approval_is_the_request"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW."company_id" IS DISTINCT FROM OLD."company_id"
     OR NEW."enquiry_id" IS DISTINCT FROM OLD."enquiry_id"
     OR NEW."quote_id" IS DISTINCT FROM OLD."quote_id"
     OR NEW."quote_revision" IS DISTINCT FROM OLD."quote_revision"
     OR NEW."value_fils" IS DISTINCT FROM OLD."value_fils"
     OR NEW."raised_by_id" IS DISTINCT FROM OLD."raised_by_id"
     OR NEW."reasons" IS DISTINCT FROM OLD."reasons"
     OR NEW."approver_id" IS DISTINCT FROM OLD."approver_id"
     OR NEW."po_number" IS DISTINCT FROM OLD."po_number"
     OR NEW."cost_code" IS DISTINCT FROM OLD."cost_code"
     OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'quote_approval %: what was asked for is fixed once asked', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('approved', 'withdrawn', 'superseded') THEN
    RAISE EXCEPTION 'quote_approval % is % and is not reopened', OLD."id", OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'pending' AND NEW."status" IN ('approved', 'queried', 'withdrawn', 'superseded'))
    OR (OLD."status" = 'queried' AND NEW."status" IN ('pending', 'withdrawn', 'superseded'))
  ) THEN
    RAISE EXCEPTION 'quote_approval %: % cannot become %', OLD."id", OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "quote_approval_is_the_request" ON "quote_approval";
CREATE TRIGGER "quote_approval_is_the_request"
  BEFORE UPDATE ON "quote_approval"
  FOR EACH ROW EXECUTE FUNCTION "quote_approval_is_the_request"();

-- ── 12 · The history is the record ───────────────────────────────────────────

-- Rows are never edited. The one change that passes is the actor's own
-- `SET NULL` when their account is deleted — `actor_name` keeps who it was.
-- Rows go only with their company, or inside a session that has set
-- `app.buyer_company_maintenance`, which only integration-test cleanup does.
CREATE OR REPLACE FUNCTION "buyer_company_event_is_the_record"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 OR current_setting('app.buyer_company_maintenance', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'buyer_company_event % is part of the company history and is not deleted', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF pg_trigger_depth() > 1
     AND NEW."actor_id" IS NULL
     AND NEW."id" = OLD."id"
     AND NEW."company_id" = OLD."company_id"
     AND NEW."actor_name" = OLD."actor_name"
     AND NEW."kind" = OLD."kind"
     AND NEW."subject" IS NOT DISTINCT FROM OLD."subject"
     AND NEW."before" IS NOT DISTINCT FROM OLD."before"
     AND NEW."after" IS NOT DISTINCT FROM OLD."after"
     AND NEW."note" IS NOT DISTINCT FROM OLD."note"
     AND NEW."created_at" = OLD."created_at" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'buyer_company_event % is part of the company history and is not edited', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS "buyer_company_event_is_the_record" ON "buyer_company_event";
CREATE TRIGGER "buyer_company_event_is_the_record"
  BEFORE UPDATE OR DELETE ON "buyer_company_event"
  FOR EACH ROW EXECUTE FUNCTION "buyer_company_event_is_the_record"();
