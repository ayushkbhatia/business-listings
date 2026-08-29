-- Handoff 5, step 4. Board 6b — curated lists.
--
-- Criterion 4: "A curated list displays its selection criteria and cannot
-- include a business that fails them; placement cannot be bought into one."
--
-- The table carries what the list is about and how it is framed. It carries no
-- membership and no ordering, because both are computed from rules that live in
-- `lib/seo/curated.ts` — and a rule in code is a rule nobody can be sold.

CREATE TABLE "curated_list" (
  "id"           TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "intro"        TEXT,
  "category_id"  TEXT NOT NULL,
  "area_id"      TEXT,
  "published_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "curated_list_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curated_list_slug_key" ON "curated_list"("slug");
CREATE INDEX "curated_list_published_at_idx" ON "curated_list"("published_at");

-- The address is in a URL. Same shape as a guide's.
ALTER TABLE "curated_list"
  ADD CONSTRAINT "curated_list_slug_shape"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- A published list has its framing written. The word floor is the service's to
-- count; "published with nothing said" is cheap to forbid here.
ALTER TABLE "curated_list"
  ADD CONSTRAINT "curated_list_published_has_intro"
  CHECK ("published_at" IS NULL OR length(btrim(coalesce("intro", ''))) > 0);

ALTER TABLE "curated_list"
  ADD CONSTRAINT "curated_list_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "curated_list"
  ADD CONSTRAINT "curated_list_area_id_fkey"
  FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
