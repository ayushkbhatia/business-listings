-- Board `2d-s` — coverage areas, the services variant of the locations step.
--
-- Additive from end to end: a new enum, a new column with a default, two new
-- tables and thirty-nine taxonomy rows. Nothing is dropped, nothing is
-- rewritten, and no existing row changes. It applies **before** the deploy that
-- reads it — `docs/deployments.md` § Ordering — and the code that ships with it
-- reads every one of these as optional, so the window between the two is a
-- window in which nothing is different.
--
-- Idempotent throughout, because this file runs on a local database that may
-- already carry it from a sibling worktree, and because the production apply
-- goes through the Supabase MCP ahead of the merge rather than through
-- `migrate deploy`.

-- ── 1 · How the work reaches the client ───────────────────────────────────
--
-- Three values and no fourth. "Hybrid" is two of these ticked, which is what a
-- multi-select is for; a fourth value would be a second way to say the same
-- thing and every reader would have to know both.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_mode') THEN
    CREATE TYPE "delivery_mode" AS ENUM ('remote', 'at_our_office', 'at_client_site');
  END IF;
END
$$;

-- Empty is a real state, not a missing one: it is what every business that
-- predates this board has, and it is half of the services publish gate. There is
-- no backfill for the same reason `sells_kind` has none — guessing an answer
-- onto 123 live listings is a claim made on the seller's behalf.
ALTER TABLE "business"
  ADD COLUMN IF NOT EXISTS "delivery_modes" "delivery_mode"[] NOT NULL DEFAULT '{}';

-- ── 2 · Where a services business works ───────────────────────────────────
--
-- Beside `business_coverage` rather than inside it. That table is a delivery
-- promise — this emirate, in this many hours — and this one is where the work
-- happens, which carries no promise because nothing is being moved. A trading
-- company with a service arm holds both and they genuinely differ.
CREATE TABLE IF NOT EXISTS "service_coverage" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "emirate"     "emirate" NOT NULL,
  "area_id"     TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_coverage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "service_coverage_business_id_idx" ON "service_coverage" ("business_id");
CREATE INDEX IF NOT EXISTS "service_coverage_emirate_idx"     ON "service_coverage" ("emirate");
CREATE INDEX IF NOT EXISTS "service_coverage_area_id_idx"     ON "service_coverage" ("area_id");

-- One row per scope, and two indexes rather than one because Postgres treats
-- NULLs as distinct: `(business, emirate, NULL)` would duplicate happily, which
-- is the row a seller creates by clicking Dubai twice on a slow connection.
-- Partial indexes rather than `NULLS NOT DISTINCT` so this holds on a server
-- older than 15 — the same pair `business_coverage` carries, for the same
-- reason, and `scripts/check-schema-invariants.sh` asserts both.
CREATE UNIQUE INDEX IF NOT EXISTS "service_coverage_business_id_area_id_key"
  ON "service_coverage" ("business_id", "area_id") WHERE "area_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "service_coverage_business_id_emirate_key"
  ON "service_coverage" ("business_id", "emirate") WHERE "area_id" IS NULL;

-- ── 3 · Free zones a firm is registered to work in ────────────────────────
--
-- A registration, not a location: a DMCC company often needs an auditor on
-- DMCC's approved list. Orthogonal to coverage — a firm can be approved in one
-- zone and cover one emirate, or cover all seven and be approved nowhere.
--
-- A table with a foreign key rather than an id array on `business`, because
-- these name rows in a closed taxonomy and the key is what keeps that true.
CREATE TABLE IF NOT EXISTS "free_zone_registration" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "area_id"     TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "free_zone_registration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "free_zone_registration_business_id_area_id_key"
  ON "free_zone_registration" ("business_id", "area_id");
CREATE INDEX IF NOT EXISTS "free_zone_registration_area_id_idx"
  ON "free_zone_registration" ("area_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_coverage_business_id_fkey') THEN
    ALTER TABLE "service_coverage"
      ADD CONSTRAINT "service_coverage_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RESTRICT, like `business_coverage`: an area with coverage on it is an area
  -- somebody is standing in, and deleting it silently would remove a claim the
  -- seller made without telling them.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_coverage_area_id_fkey') THEN
    ALTER TABLE "service_coverage"
      ADD CONSTRAINT "service_coverage_area_id_fkey"
      FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'free_zone_registration_business_id_fkey') THEN
    ALTER TABLE "free_zone_registration"
      ADD CONSTRAINT "free_zone_registration_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'free_zone_registration_area_id_fkey') THEN
    ALTER TABLE "free_zone_registration"
      ADD CONSTRAINT "free_zone_registration_area_id_fkey"
      FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 3b · Al Ain, and the ones like it ─────────────────────────────────────
--
-- A fact about how a place is searched, not about where it is. The coverage
-- picker offers these beside the seven emirates; `emirate` still has seven
-- values, so every join on the enum keeps working.
ALTER TABLE "area"
  ADD COLUMN IF NOT EXISTS "searched_as_emirate" BOOLEAN NOT NULL DEFAULT false;

-- ── 4 · The taxonomy this screen picks from ───────────────────────────────
--
-- Al Ain, and the free zones. The table held seventeen areas of which four were
-- free zones — enough for a toggle that filters a warehouse's address, and
-- nowhere near enough for a picker a firm uses to name the zones it is approved
-- to work in. The screen counts this list rather than claiming a number, so the
-- rows and the sentence above the search cannot disagree.
--
-- Rows rather than a constant, because board `2d-s` Q2 is right that more of
-- these are coming — Khor Fakkan, Ruwais — and each should be a taxonomy action
-- rather than a migration once `12h` exists. Until it does, this is the path.
--
-- `name_ar`, `lat` and `lng` are null on every row. An Arabic name or a
-- coordinate typed from memory is a fact this directory has not got; the centre
-- only seeds a new branch pin, which the seller then drags.
--
-- `ON CONFLICT (slug) DO NOTHING`, so this is a no-op on a database that already
-- has them and adds nothing it should not on one that has some.
INSERT INTO "area" ("id", "emirate", "name", "slug", "is_free_zone", "published_at", "searched_as_emirate")
VALUES
  (gen_random_uuid()::text, 'abu_dhabi'::"emirate", 'Al Ain', 'al-ain', false, NOW(), true),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'DMCC', 'dmcc', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'DIFC', 'difc', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Airport Free Zone', 'dubai-airport-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Silicon Oasis', 'dubai-silicon-oasis', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Internet City', 'dubai-internet-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Media City', 'dubai-media-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Studio City', 'dubai-studio-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Production City', 'dubai-production-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Knowledge Park', 'dubai-knowledge-park', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Science Park', 'dubai-science-park', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Design District', 'dubai-design-district', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Healthcare City', 'dubai-healthcare-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Outsource City', 'dubai-outsource-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai World Trade Centre Free Zone', 'dwtc-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai South Free Zone', 'dubai-south-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Maritime City', 'dubai-maritime-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Gold and Diamond Park', 'dubai-gold-and-diamond-park', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai CommerCity', 'dubai-commercity', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'International Humanitarian City', 'international-humanitarian-city', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Meydan Free Zone', 'meydan-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'IFZA', 'ifza', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'Dubai Auto Zone', 'dubai-auto-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'dubai'::"emirate", 'National Industries Park', 'national-industries-park', true, NOW(), false),
  (gen_random_uuid()::text, 'abu_dhabi'::"emirate", 'ADGM', 'adgm', true, NOW(), false),
  (gen_random_uuid()::text, 'abu_dhabi'::"emirate", 'Masdar City Free Zone', 'masdar-city-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'abu_dhabi'::"emirate", 'Abu Dhabi Airport Free Zone', 'abu-dhabi-airport-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'abu_dhabi'::"emirate", 'twofour54', 'twofour54', true, NOW(), false),
  (gen_random_uuid()::text, 'sharjah'::"emirate", 'Hamriyah Free Zone', 'hamriyah-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'sharjah'::"emirate", 'Sharjah Media City', 'sharjah-media-city', true, NOW(), false),
  (gen_random_uuid()::text, 'sharjah'::"emirate", 'Sharjah Publishing City', 'sharjah-publishing-city', true, NOW(), false),
  (gen_random_uuid()::text, 'sharjah'::"emirate", 'Sharjah Research Technology and Innovation Park', 'srtip', true, NOW(), false),
  (gen_random_uuid()::text, 'ajman'::"emirate", 'Ajman Media City Free Zone', 'ajman-media-city-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'ras_al_khaimah'::"emirate", 'RAKEZ', 'rakez', true, NOW(), false),
  (gen_random_uuid()::text, 'ras_al_khaimah'::"emirate", 'RAK Maritime City Free Zone', 'rak-maritime-city-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'ras_al_khaimah'::"emirate", 'RAK Digital Assets Oasis', 'rak-digital-assets-oasis', true, NOW(), false),
  (gen_random_uuid()::text, 'fujairah'::"emirate", 'Fujairah Free Zone', 'fujairah-free-zone', true, NOW(), false),
  (gen_random_uuid()::text, 'fujairah'::"emirate", 'Creative City Fujairah', 'creative-city-fujairah', true, NOW(), false),
  (gen_random_uuid()::text, 'umm_al_quwain'::"emirate", 'Umm Al Quwain Free Trade Zone', 'uaq-free-trade-zone', true, NOW(), false)
ON CONFLICT ("slug") DO NOTHING;

-- Stated separately so it is true on a database that already has the row — a
-- sibling worktree that ran an earlier draft of this file, or a later change of
-- mind about which places belong beside the emirates. `DO NOTHING` above leaves
-- an existing row alone, which is right for the name and wrong for this.
UPDATE "area" SET "searched_as_emirate" = true WHERE "slug" = 'al-ain';
