-- Board `3h-s` — scope templates, and the rule that scope is never one of them.
--
-- Additive: two tables and one nullable column. Nothing drops and no existing
-- row changes meaning, so it applies **before** the deploy that reads it —
-- `docs/deployments.md` § Ordering. Idempotent throughout.

-- ── 1 · A seller's own template ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scope_template" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "family_id"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "values"      JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scope_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scope_template_business_slug_key"
  ON "scope_template" ("business_id", "slug");
CREATE INDEX IF NOT EXISTS "scope_template_business_id_idx"
  ON "scope_template" ("business_id");

-- ── 2 · The invariant, at the model boundary rather than in a form ────────
--
-- B3, and the board is right to insist: *UI-only avoidance will not survive the
-- first import script.* A whitelist rather than a blacklist — stripping the five
-- allowed keys must leave nothing — so a field added to `Service` later cannot
-- start travelling by accident.
--
-- `name` and `turnaround` are excluded alongside `scope` and `excluded`, which
-- is where this board corrects `3g-s` B6's looser wording. Turnaround is the
-- one that looks like it should travel: it is required, so templating it would
-- make a clone arrive complete. It is also the field a buyer weighs most and
-- the one that genuinely differs between a hull survey and a pre-purchase
-- inspection — four services claiming the same turnaround is a worse outcome
-- than one blank field.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_template_travelling_keys_only') THEN
    ALTER TABLE "scope_template"
      ADD CONSTRAINT "scope_template_travelling_keys_only"
      CHECK (
        jsonb_typeof("values") = 'object'
        AND ("values" - ARRAY[
              'engagementType',
              'feeBasis',
              'deliveredWhere',
              'deliverable',
              'regulator'
            ]) = '{}'::jsonb
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_template_business_id_fkey') THEN
    ALTER TABLE "scope_template" ADD CONSTRAINT "scope_template_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RESTRICT, not CASCADE. `4e-s` retiring a family must not delete the
  -- templates a firm built on it — the board's own §States: *existing templates
  -- keep working; `New from a family` no longer offers it.*
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_template_family_id_fkey') THEN
    ALTER TABLE "scope_template" ADD CONSTRAINT "scope_template_family_id_fkey"
      FOREIGN KEY ("family_id") REFERENCES "scope_sheet_family"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 3 · Provenance on the service ─────────────────────────────────────────
--
-- B5: provenance, never a binding. A service owns its own values from the
-- moment it is created, and this answers two questions only — which template
-- would offer it a change, and how many services a template is used by.
--
-- SET NULL, because B7 says deleting a template leaves its services' values
-- intact and loses only the link.
ALTER TABLE "service" ADD COLUMN IF NOT EXISTS "scope_template_id" TEXT;

CREATE INDEX IF NOT EXISTS "service_scope_template_id_idx"
  ON "service" ("scope_template_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_scope_template_id_fkey') THEN
    ALTER TABLE "service" ADD CONSTRAINT "service_scope_template_id_fkey"
      FOREIGN KEY ("scope_template_id") REFERENCES "scope_template"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 4 · What a service has refused ────────────────────────────────────────
--
-- The offers are derived — a template value that differs from the service's own
-- is an offer, computed on read — because a stored offer queue is a second copy
-- of the template that goes stale the moment either side moves.
--
-- A decline is the one thing that cannot be derived: *I saw this and said no* is
-- a fact about the past, and without it the same offer reappears for ever. The
-- refused **value** is stored rather than a flag, so a template edited again to
-- something new offers again — declining "Per certificate" says nothing about
-- "Per day".
CREATE TABLE IF NOT EXISTS "scope_template_decline" (
  "service_id"  TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "field_key"   TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scope_template_decline_pkey" PRIMARY KEY ("service_id", "field_key")
);

CREATE INDEX IF NOT EXISTS "scope_template_decline_template_id_idx"
  ON "scope_template_decline" ("template_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_template_decline_service_id_fkey') THEN
    ALTER TABLE "scope_template_decline" ADD CONSTRAINT "scope_template_decline_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "service"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_template_decline_template_id_fkey') THEN
    ALTER TABLE "scope_template_decline" ADD CONSTRAINT "scope_template_decline_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "scope_template"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- The same whitelist as the template itself: a decline can only ever be about
  -- a field that travels.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_template_decline_travelling_key') THEN
    ALTER TABLE "scope_template_decline"
      ADD CONSTRAINT "scope_template_decline_travelling_key"
      CHECK ("field_key" IN (
        'engagementType', 'feeBasis', 'deliveredWhere', 'deliverable', 'regulator'
      ));
  END IF;
END
$$;
