-- Board `8c-s` — the scope sheet a firm picks, and the services a trade usually sells.
--
-- Additive: one nullable column, one table, and rows for two of the three
-- seeded families. Nothing drops and no existing row changes meaning, so it
-- applies **before** the deploy that reads it — `docs/deployments.md` § Ordering.
--
-- Idempotent throughout, for the reasons the last five migrations give.

-- ── 1 · The sheet the firm picked ─────────────────────────────────────────
--
-- An override in an existing chain rather than a new source of truth: a
-- service's family resolves business choice → `category.scope_family_id` up the
-- tree → the seeded default. The column has to exist for `8c-s` step 1 to mean
-- anything — all 440 category rows are null today, so every seller resolves to
-- `general` and a screen offering a choice would change nothing when they made
-- one.
--
-- SET NULL rather than CASCADE or RESTRICT: a family somebody retires should
-- drop the firm back to the category default, not delete the business and not
-- refuse the retirement.
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "scope_sheet_family_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_scope_sheet_family_id_fkey') THEN
    ALTER TABLE "business" ADD CONSTRAINT "business_scope_sheet_family_id_fkey"
      FOREIGN KEY ("scope_sheet_family_id") REFERENCES "scope_sheet_family"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 2 · What a firm in this trade usually sells ───────────────────────────
--
-- B8's *start from our audit-firm list*. Names only, and that is the whole
-- design: `3g-s` B6 and `3h-s` both refuse to template `scope` and `excluded`
-- because a pre-filled exclusions line is the one that ends up in a dispute.
-- An engagement type or a turnaround would be the same mistake one field over —
-- both are claims about how *this* firm works, and a seeded claim is a claim
-- the seller never made.
CREATE TABLE IF NOT EXISTS "scope_sheet_common_service" (
  "family_id" TEXT    NOT NULL,
  "name"      TEXT    NOT NULL,
  "position"  INTEGER NOT NULL,
  CONSTRAINT "scope_sheet_common_service_pkey" PRIMARY KEY ("family_id", "name")
);

CREATE INDEX IF NOT EXISTS "scope_sheet_common_service_family_id_position_idx"
  ON "scope_sheet_common_service" ("family_id", "position");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scope_sheet_common_service_family_id_fkey') THEN
    ALTER TABLE "scope_sheet_common_service" ADD CONSTRAINT "scope_sheet_common_service_family_id_fkey"
      FOREIGN KEY ("family_id") REFERENCES "scope_sheet_family"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 3 · The two authored trades ───────────────────────────────────────────
--
-- `general` gets none, deliberately. It is the blank sheet a trade nobody has
-- classified resolves to, and there is no list of services every business in
-- the directory sells — inventing one would put "Consultancy" in front of a
-- freight forwarder, which is the padding `CLAUDE.md` § Interface honesty
-- forbids in a different costume.
INSERT INTO "scope_sheet_common_service" ("family_id", "name", "position") VALUES
  ('audit-and-assurance',   'Statutory audit',                    0),
  ('audit-and-assurance',   'VAT return filing',                  1),
  ('audit-and-assurance',   'Corporate tax registration',         2),
  ('audit-and-assurance',   'Corporate tax return',               3),
  ('audit-and-assurance',   'Bookkeeping and management accounts', 4),
  ('audit-and-assurance',   'Transfer pricing documentation',     5),
  ('facilities-management', 'Planned preventive maintenance',     0),
  ('facilities-management', 'Reactive call-out',                  1),
  ('facilities-management', 'HVAC servicing',                     2),
  ('facilities-management', 'Deep cleaning',                      3),
  ('facilities-management', 'Fire and life safety inspection',    4)
ON CONFLICT ("family_id", "name") DO NOTHING;
