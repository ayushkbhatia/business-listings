-- Board 6f — the page matrix and content operations.
--
-- Additive throughout: three defaulted columns on `category`, one nullable
-- timestamp on each landing table, and two new tables. Nothing is dropped and
-- no existing row changes meaning, so this applies cleanly before the merge in
-- the ordering `docs/deployments.md` describes.

-- ---------------------------------------------------------------------------
-- The rules, per category, beside the two floors that already live there.
-- ---------------------------------------------------------------------------

ALTER TABLE "category"
  ADD COLUMN IF NOT EXISTS "demand_per_thousand" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS "hold_share" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS "min_live_days" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "min_intro_words" INTEGER NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS "human_review_required" BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_min_intro_words_range"
    CHECK ("min_intro_words" >= 0 AND "min_intro_words" <= 5000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Bounds in the database, not only in review.
--
-- `lib/taxonomy/service.ts` has validated `publish_threshold` against 1..5000
-- since handoff 0 and the column carries no constraint, so the only thing
-- standing between a typo and every landing page in a sector disappearing is
-- one `if` on one code path. The ranking-weights migration is the house
-- precedent for putting the rule where it cannot be bypassed; this adds the
-- missing one for the old column in the same pass as the new ones.
DO $$
BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_publish_threshold_range"
    CHECK ("publish_threshold" >= 1 AND "publish_threshold" <= 5000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_verified_share_range"
    CHECK ("verified_share_min" >= 0 AND "verified_share_min" <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_demand_per_thousand_range"
    CHECK ("demand_per_thousand" >= 0 AND "demand_per_thousand" <= 5000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A hold share above 1 would unpublish a page the moment it published, and one
-- at 0 would keep a page with no listings on it live for ever. Neither is a
-- setting anybody wants; both are a plausible slip on a form.
DO $$
BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_hold_share_range"
    CHECK ("hold_share" > 0 AND "hold_share" <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_min_live_days_range"
    CHECK ("min_live_days" >= 0 AND "min_live_days" <= 365);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Something durable to measure the minimum-live window from.
-- ---------------------------------------------------------------------------

ALTER TABLE "area_page" ADD COLUMN IF NOT EXISTS "first_published_at" TIMESTAMP(3);
ALTER TABLE "emirate_page" ADD COLUMN IF NOT EXISTS "first_published_at" TIMESTAMP(3);

-- `Held · editorial`. A person's decision to keep a page down, which is the one
-- thing on this screen no query can re-derive.
ALTER TABLE "area_page"
  ADD COLUMN IF NOT EXISTS "held_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "held_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "held_by_id" UUID;
ALTER TABLE "emirate_page"
  ADD COLUMN IF NOT EXISTS "held_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "held_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "held_by_id" UUID;

DO $$
BEGIN
  ALTER TABLE "area_page" ADD CONSTRAINT "area_page_held_reason"
    CHECK ("held_at" IS NULL OR length(btrim(coalesce("held_reason", ''))) >= 4);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "emirate_page" ADD CONSTRAINT "emirate_page_held_reason"
    CHECK ("held_at" IS NULL OR length(btrim(coalesce("held_reason", ''))) >= 4);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "area_page" ADD CONSTRAINT "area_page_held_by_id_fkey"
    FOREIGN KEY ("held_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "emirate_page" ADD CONSTRAINT "emirate_page_held_by_id_fkey"
    FOREIGN KEY ("held_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfilled from the column that exists. It is the wrong date for any page
-- that has been unpublished and republished — that history is gone — but it is
-- right for every page that has been live once and never dropped, which is all
-- of them today, and it beats starting every live page's grace at the deploy.
UPDATE "area_page" SET "first_published_at" = "published_at"
  WHERE "published_at" IS NOT NULL AND "first_published_at" IS NULL;
UPDATE "emirate_page" SET "first_published_at" = "published_at"
  WHERE "published_at" IS NOT NULL AND "first_published_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Recorded demand for one landing scope.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "scope_demand" (
  "id"               TEXT NOT NULL,
  "category_id"      TEXT NOT NULL,
  "emirate"          "emirate" NOT NULL,
  "area_id"          TEXT,
  "monthly_searches" INTEGER NOT NULL,
  "source"           TEXT NOT NULL,
  "captured_at"      TIMESTAMP(3) NOT NULL,
  "recorded_by_id"   UUID,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scope_demand_pkey" PRIMARY KEY ("id")
);

-- A recorded figure is a claim about the world; a negative one is a typo, and
-- so is 40 million searches a month for valves in Umm Al Quwain.
DO $$
BEGIN
  ALTER TABLE "scope_demand" ADD CONSTRAINT "scope_demand_monthly_searches_range"
    CHECK ("monthly_searches" >= 0 AND "monthly_searches" <= 10000000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "scope_demand" ADD CONSTRAINT "scope_demand_source_present"
    CHECK (length(btrim("source")) >= 2);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "scope_demand_category_id_emirate_area_id_key"
  ON "scope_demand" ("category_id", "emirate", "area_id");

-- The area rows are covered by the unique index above. The emirate rows carry
-- a null `area_id`, and Postgres reads every null as distinct from every other
-- one, so without this a trade could collect four contradictory demand figures
-- for the same emirate and the gate would read whichever came back first.
CREATE UNIQUE INDEX IF NOT EXISTS "scope_demand_emirate_scope_key"
  ON "scope_demand" ("category_id", "emirate") WHERE "area_id" IS NULL;

CREATE INDEX IF NOT EXISTS "scope_demand_category_id_idx" ON "scope_demand" ("category_id");
CREATE INDEX IF NOT EXISTS "scope_demand_area_id_idx" ON "scope_demand" ("area_id");

DO $$
BEGIN
  ALTER TABLE "scope_demand" ADD CONSTRAINT "scope_demand_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "scope_demand" ADD CONSTRAINT "scope_demand_area_id_fkey"
    FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "scope_demand" ADD CONSTRAINT "scope_demand_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Dual control over the rules.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE "rule_change_state" AS ENUM ('proposed', 'approved', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "publish_rule_change" (
  "id"              TEXT NOT NULL,
  "category_id"     TEXT NOT NULL,
  "before"          JSONB NOT NULL,
  "after"           JSONB NOT NULL,
  "impact"          JSONB NOT NULL,
  "state"           "rule_change_state" NOT NULL DEFAULT 'proposed',
  "proposed_by_id"  UUID NOT NULL,
  "proposed_reason" TEXT NOT NULL,
  "decided_by_id"   UUID,
  "decided_reason"  TEXT,
  "decided_at"      TIMESTAMP(3),
  "impact_at"       TIMESTAMP(3) NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "publish_rule_change_pkey" PRIMARY KEY ("id")
);

-- The rule the whole table exists for. A threshold decides whether hundreds of
-- URLs exist, and `taxonomy.write` is already the narrowest grant in the
-- matrix: there is no rung above ops lead to escalate to, so the escalation is
-- that it takes two of them. In the database, not in an `if`.
--
-- On APPROVAL only. A proposer rejecting or withdrawing their own proposal is
-- not a self-approval, and a rule demanding a second person on every exit from
-- `proposed` would leave a mistyped proposal stuck in the queue until somebody
-- else signed it off.
DO $$
BEGIN
  ALTER TABLE "publish_rule_change" ADD CONSTRAINT "publish_rule_change_second_approver"
    CHECK ("state" <> 'approved' OR "decided_by_id" <> "proposed_by_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A decided row carries a decider and a written reason, whichever way it went.
-- The same partial-check shape `listing_change_request` uses for its decision
-- reason, and the four characters are `assertReason`'s floor.
DO $$
BEGIN
  ALTER TABLE "publish_rule_change" ADD CONSTRAINT "publish_rule_change_decided_complete"
    CHECK (
      "state" = 'proposed'
      OR (
        "decided_by_id" IS NOT NULL
        AND "decided_at" IS NOT NULL
        AND length(btrim(coalesce("decided_reason", ''))) >= 4
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "publish_rule_change" ADD CONSTRAINT "publish_rule_change_proposed_reason"
    CHECK (length(btrim("proposed_reason")) >= 4);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "publish_rule_change_state_created_at_idx"
  ON "publish_rule_change" ("state", "created_at");
CREATE INDEX IF NOT EXISTS "publish_rule_change_category_id_state_idx"
  ON "publish_rule_change" ("category_id", "state");

DO $$
BEGIN
  ALTER TABLE "publish_rule_change" ADD CONSTRAINT "publish_rule_change_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "publish_rule_change" ADD CONSTRAINT "publish_rule_change_proposed_by_id_fkey"
    FOREIGN KEY ("proposed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "publish_rule_change" ADD CONSTRAINT "publish_rule_change_decided_by_id_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
