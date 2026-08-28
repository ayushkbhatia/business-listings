-- Handoff 5, step 1. Boards 10b and 6d — the guide index and the article.
--
-- Guides are the only content in this handoff that works before supply density
-- exists, which is why they come first: they earn the links the 84 area pages
-- need to rank at all.
--
-- They are deliberately outside the board 6f page matrix. That gate counts
-- listings and verified share, and a guide about payment terms has neither.
-- What a guide answers to is the word floor, and the floor it answers to is
-- the same 250 in `lib/publish-threshold.ts` rather than a second number.

CREATE TABLE "guide" (
  "id"              TEXT NOT NULL,
  "slug"            TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "summary"         TEXT NOT NULL,
  "body"            JSONB NOT NULL DEFAULT '[]',
  "byline"          TEXT,
  "cta_category_id" TEXT,
  "published_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "guide_pkey" PRIMARY KEY ("id")
);

-- A published article with no summary has nothing to put on the index card or
-- in the meta description, and a title of whitespace is a link nobody can read.
-- Checked here rather than in the service alone: the service is one caller and
-- the seed is another.
ALTER TABLE "guide"
  ADD CONSTRAINT "guide_has_words"
  CHECK (
    length(btrim("title")) >= 3
    AND length(btrim("summary")) >= 20
  );

-- The slug is in a URL, so it is lowercase, digits and hyphens or it is a
-- redirect waiting to be written. Enforced at the column rather than trusted
-- to the one form that writes it.
ALTER TABLE "guide"
  ADD CONSTRAINT "guide_slug_shape"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE UNIQUE INDEX "guide_slug_key" ON "guide"("slug");

CREATE INDEX "guide_published_at_idx" ON "guide"("published_at");

ALTER TABLE "guide"
  ADD CONSTRAINT "guide_cta_category_id_fkey"
  FOREIGN KEY ("cta_category_id") REFERENCES "category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
