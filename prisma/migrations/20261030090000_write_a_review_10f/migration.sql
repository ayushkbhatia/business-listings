-- Board `10f` — write a review.
--
-- 1. The four dimensions become skippable (`B4`). A dimension the buyer marks as
--    not applying is NULL and drops out of that dimension's average; it is never
--    a zero. `overall` stays required — it is an input, not their mean (`B3`).
--    The range check is rewritten so NULL passes and 0 or 6 still does not.
--
-- 2. `review_draft` (`B9`). One per enquiry, never visible to the seller —
--    a separate table, so none of the readers that count `review` rows can
--    count a draft.
--
-- 3. `review_revision`. Board 1m: "the edit history is not public but is
--    retained". One row per edit, holding the version it replaced. Append-only.
--
-- 4. `review_words_are_fixed`. The fourteen-day edit window, the frozen review
--    once a seller has replied, and the identity columns, held by the database
--    rather than by the one service that edits. Staff columns (hold, removal,
--    reply) are untouched by it, and so is `business_id`, which 12b's merge moves.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- The deployed code writes all four dimensions on every insert and never edits
-- a review's words outside `editReview`'s window, so nothing it does meets a
-- dropped NOT NULL, a new table or the trigger.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

-- ── 1 · skippable dimensions ────────────────────────────────────────────────

ALTER TABLE "review" ALTER COLUMN "quoted_accurate" DROP NOT NULL;
ALTER TABLE "review" ALTER COLUMN "on_time" DROP NOT NULL;
ALTER TABLE "review" ALTER COLUMN "as_described" DROP NOT NULL;
ALTER TABLE "review" ALTER COLUMN "responsiveness" DROP NOT NULL;

ALTER TABLE "review" DROP CONSTRAINT IF EXISTS "review_scores_range";
ALTER TABLE "review" ADD CONSTRAINT "review_scores_range" CHECK (
  "overall" BETWEEN 1 AND 5
  AND ("quoted_accurate" IS NULL OR "quoted_accurate" BETWEEN 1 AND 5)
  AND ("on_time" IS NULL OR "on_time" BETWEEN 1 AND 5)
  AND ("as_described" IS NULL OR "as_described" BETWEEN 1 AND 5)
  AND ("responsiveness" IS NULL OR "responsiveness" BETWEEN 1 AND 5)
);

-- ── 2 · drafts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "review_draft" (
  "id"                TEXT NOT NULL,
  "enquiry_id"        TEXT NOT NULL,
  "buyer_id"          UUID NOT NULL,
  "business_id"       TEXT NOT NULL,
  "overall"           INTEGER,
  "quoted_accurate"   INTEGER,
  "on_time"           INTEGER,
  "as_described"      INTEGER,
  "responsiveness"    INTEGER,
  "body"              TEXT NOT NULL DEFAULT '',
  "show_company_name" BOOLEAN NOT NULL DEFAULT true,
  "photos"            JSONB NOT NULL DEFAULT '[]',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "review_draft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_draft_scores_range" CHECK (
    ("overall" IS NULL OR "overall" BETWEEN 1 AND 5)
    AND ("quoted_accurate" IS NULL OR "quoted_accurate" BETWEEN 1 AND 5)
    AND ("on_time" IS NULL OR "on_time" BETWEEN 1 AND 5)
    AND ("as_described" IS NULL OR "as_described" BETWEEN 1 AND 5)
    AND ("responsiveness" IS NULL OR "responsiveness" BETWEEN 1 AND 5)
  ),
  -- Six photographs and a body the form caps; a draft is not a place to store
  -- anything larger than the review it becomes.
  CONSTRAINT "review_draft_photos_bounded" CHECK (
    jsonb_typeof("photos") = 'array' AND jsonb_array_length("photos") <= 6
  ),
  CONSTRAINT "review_draft_body_bounded" CHECK (char_length("body") <= 4000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "review_draft_enquiry_id_key" ON "review_draft" ("enquiry_id");
CREATE INDEX IF NOT EXISTS "review_draft_buyer_id_idx" ON "review_draft" ("buyer_id");
CREATE INDEX IF NOT EXISTS "review_draft_business_id_idx" ON "review_draft" ("business_id");

DO $$
BEGIN
  ALTER TABLE "review_draft"
    ADD CONSTRAINT "review_draft_enquiry_id_fkey"
    FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "review_draft"
    ADD CONSTRAINT "review_draft_buyer_id_fkey"
    FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "review_draft"
    ADD CONSTRAINT "review_draft_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "review_draft" ENABLE ROW LEVEL SECURITY;

-- ── 3 · revisions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "review_revision" (
  "id"                TEXT NOT NULL,
  "review_id"         TEXT NOT NULL,
  "overall"           INTEGER NOT NULL,
  "quoted_accurate"   INTEGER,
  "on_time"           INTEGER,
  "as_described"      INTEGER,
  "responsiveness"    INTEGER,
  "body"              TEXT NOT NULL,
  "show_company_name" BOOLEAN NOT NULL,
  "photo_paths"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "replaced_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_revision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "review_revision_review_id_replaced_at_idx"
  ON "review_revision" ("review_id", "replaced_at");

DO $$
BEGIN
  ALTER TABLE "review_revision"
    ADD CONSTRAINT "review_revision_review_id_fkey"
    FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "review_revision" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION "review_revision_is_the_record"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- A cascade from the review runs one trigger level down; a statement aimed
  -- at the history itself runs at the top.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'a review revision is the retained history and is not %', lower(TG_OP)
    USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS "review_revision_is_the_record" ON "review_revision";
CREATE TRIGGER "review_revision_is_the_record"
  BEFORE UPDATE OR DELETE ON "review_revision"
  FOR EACH ROW EXECUTE FUNCTION "review_revision_is_the_record"();

-- ── 4 · the words are fixed ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "review_words_are_fixed"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- `business_id` is not here on purpose: board 12b's audited merge moves a
  -- duplicate listing's reviews onto the survivor, and its reversal moves them
  -- back. Which enquiry, which buyer and when are never a staff decision.
  -- A foreign key's own ON UPDATE CASCADE runs a trigger level down and only
  -- follows a renamed parent, so it passes.
  IF pg_trigger_depth() = 1 AND (NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."enquiry_id" IS DISTINCT FROM OLD."enquiry_id"
     OR NEW."buyer_id" IS DISTINCT FROM OLD."buyer_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."editable_until" IS DISTINCT FROM OLD."editable_until")
  THEN
    RAISE EXCEPTION 'review % keeps its enquiry, buyer and dates', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW."overall" IS DISTINCT FROM OLD."overall"
      OR NEW."quoted_accurate" IS DISTINCT FROM OLD."quoted_accurate"
      OR NEW."on_time" IS DISTINCT FROM OLD."on_time"
      OR NEW."as_described" IS DISTINCT FROM OLD."as_described"
      OR NEW."responsiveness" IS DISTINCT FROM OLD."responsiveness"
      OR NEW."body" IS DISTINCT FROM OLD."body"
      OR NEW."show_company_name" IS DISTINCT FROM OLD."show_company_name")
     AND (OLD."editable_until" <= now()
          OR OLD."seller_reply" IS NOT NULL
          OR OLD."removed_at" IS NOT NULL
          OR OLD."held_at" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'review % is past editing: the window has closed, the supplier replied, or staff have acted on it', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "review_words_are_fixed" ON "review";
CREATE TRIGGER "review_words_are_fixed"
  BEFORE UPDATE ON "review"
  FOR EACH ROW EXECUTE FUNCTION "review_words_are_fixed"();

-- Callable only by their triggers.
REVOKE ALL ON FUNCTION public.review_revision_is_the_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_words_are_fixed() FROM PUBLIC, anon, authenticated;
