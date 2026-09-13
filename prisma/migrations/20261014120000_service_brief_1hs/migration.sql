-- Board `1h-s` — the brief a buyer writes for work, `/rfq/new`.
--
-- One table and two enums. The goods composer asks a parts list; a facilities
-- contract, an audit or a customs retainer has no line to put in it. What a
-- brief carries that `enquiry` does not already hold is the trade, the
-- engagement shape, the cadence, the start and the building — so that is all
-- this adds. The description, the site, the scale and the files already have
-- columns, and a second copy of any of them is a second thing to drift.
--
-- **Additive.** A new table nothing reads yet and two new types. Every existing
-- enquiry has no brief, which is exactly what it is: an enquiry for things.
-- Applies before the merge.

DO $$
BEGIN
  CREATE TYPE "service_cadence" AS ENUM ('monthly', 'quarterly', 'annually');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "brief_start" AS ENUM ('from_date', 'asap');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "service_brief" (
  "enquiry_id"      TEXT NOT NULL,
  "category_id"     TEXT NOT NULL,
  "engagement_type" "engagement_type" NOT NULL,
  "cadence"         "service_cadence",
  "start_mode"      "brief_start" NOT NULL,
  "starts_on"       DATE,
  "building"        TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_brief_pkey" PRIMARY KEY ("enquiry_id"),

  -- B4: a cadence belongs to an ongoing contract and to nothing else. Enforced
  -- here rather than in a form, because a form is one writer of several.
  CONSTRAINT "service_brief_cadence_ongoing_only"
    CHECK ("cadence" IS NULL OR "engagement_type" = 'ongoing_contract'),

  -- A date exactly when the buyer said "starting from", and never otherwise.
  -- "As soon as possible" with a date is two answers; "from" with none is none.
  CONSTRAINT "service_brief_start_date_matches_mode"
    CHECK (("start_mode" = 'from_date') = ("starts_on" IS NOT NULL)),

  -- The building line is one line. A paragraph belongs in the description.
  CONSTRAINT "service_brief_building_length"
    CHECK ("building" IS NULL OR char_length("building") BETWEEN 1 AND 120)
);

DO $$
BEGIN
  ALTER TABLE "service_brief"
    ADD CONSTRAINT "service_brief_enquiry_id_fkey"
    FOREIGN KEY ("enquiry_id") REFERENCES "enquiry" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `RESTRICT`: the trade a brief was routed on is a fact about a sent enquiry.
-- Removing a subcategory buyers have briefed against is a decision for staff.
DO $$
BEGIN
  ALTER TABLE "service_brief"
    ADD CONSTRAINT "service_brief_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The page's "first reply within" line reads recent briefs, and `3l`-style
-- panels will group them by trade over a date range.
CREATE INDEX IF NOT EXISTS "service_brief_category_id_created_at_idx"
  ON "service_brief" ("category_id", "created_at");
