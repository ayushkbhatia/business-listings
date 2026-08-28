-- Handoff 5, step 3. Board 6a — the area landing page.
--
-- 84 category×emirate combinations plus area-level depth. Keyed on the pair,
-- because `Area.publishedAt` answers "is Al Quoz worth a page" and this answers
-- "is HVAC in Al Quoz worth one" — a different question, with a different
-- answer for every trade in the area. Criterion 1 is stated per page.

CREATE TABLE "area_page" (
  "id"           TEXT NOT NULL,
  "area_id"      TEXT NOT NULL,
  "category_id"  TEXT NOT NULL,
  "intro"        TEXT,
  "published_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "area_page_pkey" PRIMARY KEY ("id")
);

-- One page per trade per area. Two rows for the same pair would be two URLs
-- competing for the same query, which is the doorway-page failure the whole
-- handoff exists to avoid.
CREATE UNIQUE INDEX "area_page_area_id_category_id_key" ON "area_page"("area_id", "category_id");

CREATE INDEX "area_page_published_at_idx" ON "area_page"("published_at");

-- A published page has an intro. The word floor is the service's to enforce —
-- it is a count, and counting words in a check constraint is a worse version of
-- `countWords` — but "published with no copy at all" is cheap to forbid here
-- and is the state a direct UPDATE would otherwise leave behind.
ALTER TABLE "area_page"
  ADD CONSTRAINT "area_page_published_has_intro"
  CHECK ("published_at" IS NULL OR length(btrim(coalesce("intro", ''))) > 0);

ALTER TABLE "area_page"
  ADD CONSTRAINT "area_page_area_id_fkey"
  FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "area_page"
  ADD CONSTRAINT "area_page_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
