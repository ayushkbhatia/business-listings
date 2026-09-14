-- Board `6h` — homepage curation: the four "Verified this week" slots and the
-- popular-search chips, the two rails on the home page a person chooses.
--
-- 1. `homepage_slot`. Position 1–4, one row per position and one per business.
--    No eligibility column: the tier is read live when the rail renders (B1),
--    so a lapsed licence empties its card without anything writing here (B2).
-- 2. `curated_query`. A label plus the `/search` query string it runs (B8),
--    position 1–6 — six is the cap the hero row takes (Q2).
-- 3. The six chips the page used to fall back to when it had no search log,
--    carried over so the hero row reads the same the moment this ships. The
--    chips stop being mined from search volume with this board; these are the
--    typed ones the handoff draws. `added_by_id` is null on them because no
--    person added them. Inserted only into an empty table, so a second run —
--    or a run after staff have edited the row — changes nothing.
--
-- No slots are carried over. The rail they replace was computed from the audit
-- log, and copying today's computation into a table would put a choice nobody
-- made into the one rail defined by somebody making it. Until an ops lead fills
-- a slot the section does not render on `1a`, which is the cold-start state the
-- spec draws.
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- The code on `main` reads neither table. Idempotent: applied through the
-- Supabase MCP and then recorded, a second run is a no-op.

CREATE TABLE IF NOT EXISTS "homepage_slot" (
  "id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "business_id" TEXT NOT NULL,
  "added_by_id" UUID NOT NULL,
  "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "homepage_slot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "homepage_slot_position_range" CHECK ("position" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX IF NOT EXISTS "homepage_slot_business_id_key" ON "homepage_slot"("business_id");
CREATE UNIQUE INDEX IF NOT EXISTS "homepage_slot_position_key" ON "homepage_slot"("position");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_slot_business_id_fkey') THEN
    ALTER TABLE "homepage_slot"
      ADD CONSTRAINT "homepage_slot_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "curated_query" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "added_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "curated_query_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "curated_query_position_range" CHECK ("position" BETWEEN 1 AND 6),
  CONSTRAINT "curated_query_label_length" CHECK (char_length("label") BETWEEN 2 AND 40),
  CONSTRAINT "curated_query_query_present" CHECK (char_length("query") BETWEEN 3 AND 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS "curated_query_position_key" ON "curated_query"("position");

INSERT INTO "curated_query" ("id", "label", "query", "position")
SELECT seed.id, seed.label, seed.query, seed.position
FROM (VALUES
  ('curated_query_6h_1', 'HVAC maintenance AMC', 'q=HVAC+maintenance+AMC', 1),
  ('curated_query_6h_2', 'Steel fabrication', 'q=Steel+fabrication', 2),
  ('curated_query_6h_3', 'Pallet racking', 'q=Pallet+racking', 3),
  ('curated_query_6h_4', 'Trade licence renewal', 'q=Trade+licence+renewal', 4),
  ('curated_query_6h_5', 'Corporate catering', 'q=Corporate+catering', 5),
  ('curated_query_6h_6', 'Chilled water pumps', 'q=Chilled+water+pumps', 6)
) AS seed(id, label, query, position)
WHERE NOT EXISTS (SELECT 1 FROM "curated_query");
