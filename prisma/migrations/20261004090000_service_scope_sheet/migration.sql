-- Boards `3g-s`, `3f-s`, `1g-s` — the scope sheet, end to end.
--
-- Additive from end to end: three enums, five tables, two columns and the
-- seeded families. Nothing is dropped, nothing is rewritten, and no existing
-- row changes except `plan.service_limit`, which is a new column being given
-- its first values. It applies **before** the deploy that reads it —
-- `docs/deployments.md` § Ordering.
--
-- Idempotent throughout, because this file runs on a local database that may
-- already carry it from a sibling worktree, and because the production apply
-- goes through the Supabase MCP ahead of the merge rather than through
-- `migrate deploy`.

-- ── 1 · The three enums ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'engagement_type') THEN
    CREATE TYPE "engagement_type" AS ENUM ('ongoing_contract', 'one_off_job', 'call_off');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivered_where') THEN
    CREATE TYPE "delivered_where" AS ENUM ('remote', 'at_our_office', 'on_site');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_status') THEN
    CREATE TYPE "service_status" AS ENUM ('draft', 'live');
  END IF;
END
$$;

-- ── 2 · The eighth plan number ────────────────────────────────────────────
--
-- Board `2e-s`. D1 ratified seven and this was not among them, because services
-- were not their own model yet. They are now, and a cap that does not exist is
-- not a generous cap — it is `product_limit` quietly not applying to half the
-- directory.
--
-- Three, fifteen, unlimited. **Proposed, not ratified**, and they are rows, so
-- changing them is an UPDATE rather than a deploy. Sized from what a services
-- business holds: an FM contractor has six, an audit practice four, nobody has
-- six hundred.
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "service_limit" INTEGER;

UPDATE "plan" SET "service_limit" = 3  WHERE "id" = 'free'  AND "service_limit" IS NULL;
UPDATE "plan" SET "service_limit" = 15 WHERE "id" = 'basic' AND "service_limit" IS NULL;
-- Pro is null, which is unlimited, and matches every other cap on that plan.

-- ── 3 · Scope-sheet families ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scope_sheet_family" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scope_sheet_family_pkey" PRIMARY KEY ("id")
);

-- At most one default, and Prisma cannot express it. Two defaults is a coin
-- flip over which fee bases a seller in an unclassified trade is offered, and
-- the flip would land differently between two requests on the same screen.
CREATE UNIQUE INDEX IF NOT EXISTS "scope_sheet_family_one_default"
  ON "scope_sheet_family" (("is_default")) WHERE "is_default";

CREATE TABLE IF NOT EXISTS "scope_sheet_fee_basis" (
  "family_id" TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "position"  INTEGER NOT NULL,
  CONSTRAINT "scope_sheet_fee_basis_pkey" PRIMARY KEY ("family_id", "key")
);
CREATE INDEX IF NOT EXISTS "scope_sheet_fee_basis_family_id_position_idx"
  ON "scope_sheet_fee_basis" ("family_id", "position");

CREATE TABLE IF NOT EXISTS "scope_sheet_row" (
  "family_id"  TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "position"   INTEGER NOT NULL,
  "filterable" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "scope_sheet_row_pkey" PRIMARY KEY ("family_id", "key")
);
CREATE INDEX IF NOT EXISTS "scope_sheet_row_family_id_position_idx"
  ON "scope_sheet_row" ("family_id", "position");

-- Null inherits from the parent, resolved by the same ancestor walk
-- `trade_kind` uses. Every one of the 440 categories is null today, so every
-- service lands on the `general` family until `12h` assigns them.
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "scope_family_id" TEXT;

-- ── 4 · The record ────────────────────────────────────────────────────────
--
-- Every one of the six required fields is nullable. Board `3g-s` B4: six
-- required fields make a sheet *complete*, not *publishable*. A NOT NULL here
-- would be the completeness gate the board spends two paragraphs refusing.
CREATE TABLE IF NOT EXISTS "service" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "category_id"     TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "slug"            TEXT NOT NULL,
  "engagement_type" "engagement_type",
  "fee_basis"       TEXT,
  "turnaround"      TEXT,
  "delivered_where" "delivered_where",
  "deliverable"     TEXT,
  "scope"           TEXT,
  "excluded"        TEXT,
  "indicative_fee"  TEXT,
  "status"          "service_status" NOT NULL DEFAULT 'draft',
  "position"        INTEGER NOT NULL DEFAULT 0,
  "published_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- Unique per business, not globally. Two firms both offering *Statutory audit*
-- is the normal case and the comparison this directory exists for.
CREATE UNIQUE INDEX IF NOT EXISTS "service_business_id_slug_key"
  ON "service" ("business_id", "slug");
CREATE INDEX IF NOT EXISTS "service_business_id_status_idx" ON "service" ("business_id", "status");
CREATE INDEX IF NOT EXISTS "service_business_id_position_idx" ON "service" ("business_id", "position");

CREATE TABLE IF NOT EXISTS "scope_field_value" (
  "id"         TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "field_key"  TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scope_field_value_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "scope_field_value_service_id_field_key_key"
  ON "scope_field_value" ("service_id", "field_key");

CREATE TABLE IF NOT EXISTS "service_revision" (
  "id"         TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "actor_id"   UUID NOT NULL,
  "field"      TEXT NOT NULL,
  "before"     TEXT,
  "after"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_revision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "service_revision_service_id_created_at_idx"
  ON "service_revision" ("service_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_scope_family_id_fkey') THEN
    ALTER TABLE "category" ADD CONSTRAINT "category_scope_family_id_fkey"
      FOREIGN KEY ("scope_family_id") REFERENCES "scope_sheet_family"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_sheet_fee_basis_family_id_fkey') THEN
    ALTER TABLE "scope_sheet_fee_basis" ADD CONSTRAINT "scope_sheet_fee_basis_family_id_fkey"
      FOREIGN KEY ("family_id") REFERENCES "scope_sheet_family"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_sheet_row_family_id_fkey') THEN
    ALTER TABLE "scope_sheet_row" ADD CONSTRAINT "scope_sheet_row_family_id_fkey"
      FOREIGN KEY ("family_id") REFERENCES "scope_sheet_family"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_business_id_fkey') THEN
    ALTER TABLE "service" ADD CONSTRAINT "service_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RESTRICT on the category, like `Product`: a trade with services in it is a
  -- trade somebody is trading in, and deleting it silently would orphan a
  -- public page.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_category_id_fkey') THEN
    ALTER TABLE "service" ADD CONSTRAINT "service_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "category"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_field_value_service_id_fkey') THEN
    ALTER TABLE "scope_field_value" ADD CONSTRAINT "scope_field_value_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "service"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_revision_service_id_fkey') THEN
    ALTER TABLE "service_revision" ADD CONSTRAINT "service_revision_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "service"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RESTRICT on the actor. A change log that loses who made the change answers
  -- none of the questions it exists for.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_revision_actor_id_fkey') THEN
    ALTER TABLE "service_revision" ADD CONSTRAINT "service_revision_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "user"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 5 · The seeded families ───────────────────────────────────────────────
--
-- Three: the fallback, and the two the design renders use. A family is data, so
-- a fourth is an INSERT rather than a deploy — which is the point of the table.
--
-- `general` is the fallback, not a global list. The difference matters: a
-- global list would be offered to a facilities-management firm *instead of*
-- per-sq-ft-per-year, which board `3g-s` B2 calls "wrong for every family at
-- once". This one is what a trade nobody has classified yet resolves to, the
-- same way an unset `trade_kind` resolves to `goods`.
INSERT INTO "scope_sheet_family" ("id", "name", "is_default", "updated_at") VALUES
  ('general',               'General services',         true,  NOW()),
  ('facilities-management', 'Facilities management',    false, NOW()),
  ('audit-and-assurance',   'Audit & assurance',        false, NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "scope_sheet_fee_basis" ("family_id", "key", "label", "position") VALUES
  ('general', 'fixed_fee',     'Fixed fee',       0),
  ('general', 'per_hour',      'Per hour',        1),
  ('general', 'per_day',       'Per day',         2),
  ('general', 'per_visit',     'Per visit',       3),
  ('general', 'per_month',     'Per month',       4),
  ('general', 'retainer',      'Retainer',        5),
  ('general', 'on_assessment', 'On assessment',   6),

  ('facilities-management', 'per_month',     'Per month',       0),
  ('facilities-management', 'per_visit',     'Per visit',       1),
  ('facilities-management', 'per_sqft_yr',   'Per sq ft / yr',  2),
  ('facilities-management', 'fixed_fee',     'Fixed fee',       3),
  ('facilities-management', 'on_assessment', 'On assessment',   4),

  ('audit-and-assurance', 'fixed_fee',     'Fixed fee',     0),
  ('audit-and-assurance', 'per_hour',      'Per hour',      1),
  ('audit-and-assurance', 'retainer',      'Retainer',      2),
  ('audit-and-assurance', 'on_assessment', 'On assessment', 3)
ON CONFLICT ("family_id", "key") DO NOTHING;

-- The row order is the comparison instrument: every firm in a family renders
-- the same rows in the same order, so a buyer reading three audit practices
-- reads the same nine rows three times.
--
-- `filterable` is five rows, not the six the design render marks. Turnaround
-- carries the marker there and cannot earn it under the board's own rule —
-- "a row only becomes filterable when its values are enumerable across the
-- family", and "24/7 callout, 4-hour attendance" is not a facet value. The
-- spec's prose says five; the render's markers say six; the rule settles it.
INSERT INTO "scope_sheet_row" ("family_id", "key", "label", "position", "filterable") VALUES
  ('general', 'engagement_type',      'Engagement type',        0, true),
  ('general', 'turnaround',           'Turnaround',             1, false),
  ('general', 'fee_basis',            'Fee basis',              2, true),
  ('general', 'deliverable',          'Deliverable',            3, false),
  ('general', 'delivered_where',      'Delivered where',        4, true),
  ('general', 'regulator',            'Regulator or standard',  5, true),
  ('general', 'requires_from_client', 'What we need from you',  6, false),
  ('general', 'sectors',              'Sectors served',         7, true),
  ('general', 'languages',            'Languages',              8, false),

  ('facilities-management', 'engagement_type',      'Engagement type',       0, true),
  ('facilities-management', 'turnaround',           'Response time',         1, false),
  ('facilities-management', 'fee_basis',            'Fee basis',             2, true),
  ('facilities-management', 'deliverable',          'Deliverable',           3, false),
  ('facilities-management', 'delivered_where',      'Delivered where',       4, true),
  ('facilities-management', 'regulator',            'Standard applied',      5, true),
  ('facilities-management', 'requires_from_client', 'What we need on site',  6, false),
  ('facilities-management', 'sectors',              'Sectors served',        7, true),
  ('facilities-management', 'languages',            'Languages',             8, false),

  ('audit-and-assurance', 'engagement_type',      'Engagement type',       0, true),
  ('audit-and-assurance', 'turnaround',           'Turnaround',            1, false),
  ('audit-and-assurance', 'fee_basis',            'Fee basis',             2, true),
  ('audit-and-assurance', 'deliverable',          'Deliverable',           3, false),
  ('audit-and-assurance', 'delivered_where',      'Delivered where',       4, true),
  ('audit-and-assurance', 'regulator',            'Standard applied',      5, true),
  ('audit-and-assurance', 'requires_from_client', 'You provide',           6, false),
  ('audit-and-assurance', 'sectors',              'Sectors most audited',  7, true),
  ('audit-and-assurance', 'languages',            'Languages',             8, false)
ON CONFLICT ("family_id", "key") DO NOTHING;
