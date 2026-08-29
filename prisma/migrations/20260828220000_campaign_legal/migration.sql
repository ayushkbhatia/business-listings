-- Handoff 5, step 5. Boards 10i and 10j, and criterion 9.
--
--   "Campaign pages preserve UTM through to the enquiry and attribute it in
--    admin."
--
-- The attribution columns are on `enquiry` rather than on a join table because
-- an enquiry has exactly one origin and the console groups by it. Three
-- columns, not five: nothing reports on `utm_content` or `utm_term`, and an
-- attribution column nobody reads is personal data kept for no reason.

CREATE TABLE "campaign" (
  "id"               TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "headline"         TEXT NOT NULL,
  "standfirst"       TEXT,
  "body"             TEXT,
  "meta_title"       TEXT,
  "meta_description" TEXT,
  "cta_category_id"  TEXT,
  "published_at"     TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_slug_key" ON "campaign"("slug");
CREATE INDEX "campaign_published_at_idx" ON "campaign"("published_at");

ALTER TABLE "campaign"
  ADD CONSTRAINT "campaign_slug_shape"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "campaign"
  ADD CONSTRAINT "campaign_cta_category_id_fkey"
  FOREIGN KEY ("cta_category_id") REFERENCES "category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "legal_page_kind" AS ENUM ('terms', 'privacy', 'verification_policy', 'review_policy');

CREATE TABLE "legal_page" (
  "id"             TEXT NOT NULL,
  "kind"           "legal_page_kind" NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "updated_at"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "legal_page_pkey" PRIMARY KEY ("id")
);

-- One row per kind. Four pages, four rows, and no way to have two live terms.
CREATE UNIQUE INDEX "legal_page_kind_key" ON "legal_page"("kind");

-- A policy with no wording is not a policy. There is no draft state here on
-- purpose: these four are always live, and an empty one is a broken page
-- rather than an unpublished one.
ALTER TABLE "legal_page"
  ADD CONSTRAINT "legal_page_has_body"
  CHECK (length(btrim("body")) >= 100 AND length(btrim("title")) >= 3);

ALTER TABLE "enquiry" ADD COLUMN "utm_source"   TEXT;
ALTER TABLE "enquiry" ADD COLUMN "utm_medium"   TEXT;
ALTER TABLE "enquiry" ADD COLUMN "utm_campaign" TEXT;
ALTER TABLE "enquiry" ADD COLUMN "campaign_id"  TEXT;

ALTER TABLE "enquiry"
  ADD CONSTRAINT "enquiry_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The console groups by campaign over a date range.
CREATE INDEX "enquiry_utm_campaign_created_at_idx" ON "enquiry"("utm_campaign", "created_at");
