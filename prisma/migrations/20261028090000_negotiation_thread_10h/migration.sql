-- Board `10h` — the negotiation thread, buyer side.
--
-- Three things the thread needed from the table it has always lived in, and one
-- rule held by the database rather than by every screen that reads it.
--
-- 1. `message.author_side` (B5). Whose words a message is, stated at write.
--    Every reader derived it from `sender.business_id = message.business_id`,
--    which is a fact about the sender *today*: a seat removed from a team has its
--    `business_id` cleared, and every message it wrote moved to the buyer's side
--    of the thread — on the buyer's screen, the seller's, and the evidence page
--    staff judge a supplier report against. Backfilled from the enquiry, whose
--    `buyer_id` is the one sender that is the buyer by definition.
--
-- 2. `message.read_at`. The `READ` the board draws under the buyer's own
--    message. Symmetric (board 11b §6): the buyer opening a thread stamps the
--    seller's messages, the seller opening it stamps the buyer's. Set once.
--
-- 3. `message_attachment` and document kind `thread_attachment` (Q5). A file
--    sent in one thread is reachable through its message only, so by the two
--    sides of that thread and by no other recipient of the enquiry.
--
-- 4. `message_is_the_record` (B10). The thread is the dispute record and nothing
--    in it is editable or deletable by either side once sent. Every column is
--    fixed at insert except `read_at`, which may be set once, and
--    `quote_revision_id`, which only its own `ON DELETE SET NULL` may clear. A
--    row is deleted only by a cascade from its enquiry, business or sender —
--    never by a statement aimed at the message itself — or inside a session that
--    has set `app.thread_maintenance`, which only integration-test cleanup does.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- The deployed code inserts messages without `author_side`, so the column is not
-- left for it to fail on: the insert trigger fills a missing side from the
-- enquiry, which is the same derivation the backfill uses, and the code this
-- migration ships with states it explicitly. NOT NULL holds either way — a BEFORE
-- trigger runs before the constraint is checked.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run is
-- a no-op.

-- ── 1 · author_side ─────────────────────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE "message_author_side" AS ENUM ('buyer', 'seller');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "author_side" "message_author_side";

UPDATE "message" AS m
   SET "author_side" = CASE WHEN m."sender_id" = e."buyer_id" THEN 'buyer'::"message_author_side"
                            ELSE 'seller'::"message_author_side" END
  FROM "enquiry" AS e
 WHERE e."id" = m."enquiry_id"
   AND m."author_side" IS NULL;

ALTER TABLE "message" ALTER COLUMN "author_side" SET NOT NULL;

-- ── 2 · read_at ─────────────────────────────────────────────────────────────

ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

-- The unread count on the buyer's rail and the stamp on opening both look for a
-- thread's unread messages from one side.
CREATE INDEX IF NOT EXISTS "message_unread_idx"
  ON "message" ("enquiry_id", "business_id", "author_side")
  WHERE "read_at" IS NULL;

-- ── 3 · attachments ─────────────────────────────────────────────────────────

ALTER TYPE "document_kind" ADD VALUE IF NOT EXISTS 'thread_attachment';

CREATE TABLE IF NOT EXISTS "message_attachment" (
  "message_id"  TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_attachment_pkey" PRIMARY KEY ("message_id", "document_id")
);

CREATE INDEX IF NOT EXISTS "message_attachment_document_idx" ON "message_attachment" ("document_id");

DO $$
BEGIN
  ALTER TABLE "message_attachment"
    ADD CONSTRAINT "message_attachment_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "message_attachment"
    ADD CONSTRAINT "message_attachment_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Row level security on, no policies: the PostgREST lockdown every table in
-- `public` carries. The application reaches it through Prisma only.
ALTER TABLE "message_attachment" ENABLE ROW LEVEL SECURITY;

-- ── 4 · the record ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "message_is_the_record"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  buyer UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A cascade from the enquiry, business or sender runs inside the foreign
    -- key's own trigger, one level down. A statement aimed at the message runs
    -- at the top.
    IF pg_trigger_depth() > 1 OR current_setting('app.thread_maintenance', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'message % is part of the record and is not deleted', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."author_side" IS NULL THEN
      SELECT "buyer_id" INTO buyer FROM "enquiry" WHERE "id" = NEW."enquiry_id";
      NEW."author_side" := CASE WHEN NEW."sender_id" = buyer THEN 'buyer'::"message_author_side"
                                ELSE 'seller'::"message_author_side" END;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE.
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."enquiry_id" IS DISTINCT FROM OLD."enquiry_id"
     OR NEW."business_id" IS DISTINCT FROM OLD."business_id"
     OR NEW."sender_id" IS DISTINCT FROM OLD."sender_id"
     OR NEW."author_side" IS DISTINCT FROM OLD."author_side"
     OR NEW."body" IS DISTINCT FROM OLD."body"
     OR NEW."automatic" IS DISTINCT FROM OLD."automatic"
     OR NEW."flagged_at" IS DISTINCT FROM OLD."flagged_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'message % is part of the record and is not edited', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."read_at" IS NOT NULL AND NEW."read_at" IS DISTINCT FROM OLD."read_at" THEN
    RAISE EXCEPTION 'message % was already read; the first opening is the receipt', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."quote_revision_id" IS DISTINCT FROM OLD."quote_revision_id" AND NEW."quote_revision_id" IS NOT NULL THEN
    RAISE EXCEPTION 'message % already says which revision it carries', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "message_is_the_record" ON "message";
CREATE TRIGGER "message_is_the_record"
  BEFORE INSERT OR UPDATE OR DELETE ON "message"
  FOR EACH ROW EXECUTE FUNCTION "message_is_the_record"();

CREATE OR REPLACE FUNCTION "message_attachment_is_the_record"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  found_kind TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 OR current_setting('app.thread_maintenance', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'an attachment on message % is part of the record and is not removed', OLD."message_id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'an attachment on message % is part of the record and is not changed', OLD."message_id"
      USING ERRCODE = 'check_violation';
  END IF;

  -- A thread attachment only. A trade licence or another enquiry's file hung
  -- off a message would be readable by a party it was never sent to.
  SELECT d."kind"::TEXT INTO found_kind FROM "document" AS d WHERE d."id" = NEW."document_id";
  IF found_kind IS DISTINCT FROM 'thread_attachment' THEN
    RAISE EXCEPTION 'document % is not a thread attachment', NEW."document_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "message_attachment_is_the_record" ON "message_attachment";
CREATE TRIGGER "message_attachment_is_the_record"
  BEFORE INSERT OR UPDATE OR DELETE ON "message_attachment"
  FOR EACH ROW EXECUTE FUNCTION "message_attachment_is_the_record"();

-- Callable only by their triggers.
REVOKE ALL ON FUNCTION public.message_is_the_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_attachment_is_the_record() FROM PUBLIC, anon, authenticated;
