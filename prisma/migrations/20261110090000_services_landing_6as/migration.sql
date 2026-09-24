-- Board `6a-s` — the area landing page for trades sold by the job.
--
-- The page itself is a query: which firms cover this place for this trade,
-- resolved per service through `effectiveCoverage`, and counted by the same
-- function the publish gate, the sitemap and the matrix read. Nothing about
-- that is stored. What this migration adds is the three things a person has to
-- decide and a query cannot:
--
--  1. **`category.plural_human`** — what the page calls the people who do the
--     work. *VAT consultants in Business Bay, Dubai* (correction 3). Board 6a's
--     H1 rule takes the category record's plural human form; for a trade sold
--     by the job that is a noun per trade, which is data.
--  2. **`category.credential_kind`** — the credential buyers in this trade look
--     for, where the scope-sheet family cannot say (`4e-s` Q3: Professional
--     services holds tax, audit and law, and each has its own regulator). Null
--     inherits up the tree and then from the family. It only ever produces a
--     count of firms holding the credential *checked against a register*.
--  3. **`category.services_landing_opened_at`** — the rollout flag, per trade.
--     Build phase 5: roll one trade out first and check it in Search Console
--     before opening the others. Closed means a landing page in the trade
--     cannot be live, rather than rendering the goods template (`6a-s` B2).
--  4. **`category_ask`** — *What to ask*, three questions per trade and never
--     per area (B9). Replaced whole, audited, by `saveServicesLandingCopy`.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` §
-- Ordering). Every new column is nullable and nothing deployed reads it; the
-- table is new. A `category` load with no `select` names every column the
-- client declares, so the columns must exist before the code that declares
-- them is served — which is what applying first guarantees.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

-- ── 1 · The trade's own words ────────────────────────────────────────────────

ALTER TABLE "category"
  ADD COLUMN IF NOT EXISTS "plural_human"               TEXT,
  ADD COLUMN IF NOT EXISTS "credential_kind"            "credential_kind",
  ADD COLUMN IF NOT EXISTS "services_landing_opened_at" TIMESTAMP(3);

-- Trimmed, and short enough to sit in an H1 beside a place name. The service
-- refuses the same shapes with a sentence; this is the floor under it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_plural_human_shape') THEN
    ALTER TABLE "category" ADD CONSTRAINT "category_plural_human_shape"
      CHECK (
        "plural_human" IS NULL
        OR ("plural_human" = btrim("plural_human") AND char_length("plural_human") BETWEEN 2 AND 60)
      );
  END IF;
END $$;

-- ── 2 · What to ask ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "category_ask" (
  "id"          TEXT         NOT NULL,
  "category_id" TEXT         NOT NULL,
  "position"    INTEGER      NOT NULL,
  "question"    TEXT         NOT NULL,
  "why"         TEXT         NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "category_ask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "category_ask_category_id_position_key"
  ON "category_ask" ("category_id", "position");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_ask_category_id_fkey') THEN
    ALTER TABLE "category_ask" ADD CONSTRAINT "category_ask_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Three at most. The board draws three, and a fourth turns an editorial block
-- into a questionnaire.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_ask_position_range') THEN
    ALTER TABLE "category_ask" ADD CONSTRAINT "category_ask_position_range"
      CHECK ("position" BETWEEN 0 AND 2);
  END IF;
END $$;

-- A question and its reason, both written and neither padded. The lengths are
-- the service's own caps: a question is one line, a reason one or two
-- sentences.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_ask_text_shape') THEN
    ALTER TABLE "category_ask" ADD CONSTRAINT "category_ask_text_shape"
      CHECK (
        "question" = btrim("question") AND char_length("question") BETWEEN 1 AND 160
        AND "why" = btrim("why") AND char_length("why") BETWEEN 1 AND 400
      );
  END IF;
END $$;
