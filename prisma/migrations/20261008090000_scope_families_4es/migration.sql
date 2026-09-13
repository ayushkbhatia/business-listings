-- Board `4e-s` — five scope-sheet families, and what a family carries.
--
-- Additive plus two renames. The renames are `UPDATE`s on a primary key whose
-- every foreign key is `ON UPDATE CASCADE` (checked before writing this), so
-- the references move with them and nothing is orphaned.
--
-- Applies **before** the deploy that reads it — `docs/deployments.md` § Ordering.
-- Idempotent throughout.

-- ── 1 · What a family carries beyond its rows and fee bases ───────────────
ALTER TABLE "scope_sheet_family" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scope_sheet_family" ADD COLUMN IF NOT EXISTS "credential_kind" "credential_kind";
ALTER TABLE "scope_sheet_family" ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP(3);

-- ── 2 · The two existing families become two of the board's five ──────────
--
-- `audit-and-assurance` and `facilities-management` were authored at the
-- subcategory's level of granularity; `4e-s` says the level is one up — *a spec
-- sheet describes an object, a scope sheet describes an arrangement, and there
-- are only so many ways to sell work.* So they are renamed rather than joined
-- by five more, which would leave seven families and lose B10's point.
--
-- Every foreign key to this table is ON UPDATE CASCADE, so the templates,
-- businesses, categories, fee bases, rows and common services follow.
UPDATE "scope_sheet_family"
   SET "id" = 'professional-services', "name" = 'Professional services'
 WHERE "id" = 'audit-and-assurance';

UPDATE "scope_sheet_family"
   SET "id" = 'on-site-maintenance', "name" = 'On-site maintenance'
 WHERE "id" = 'facilities-management';

-- ── 3 · The three the board adds ──────────────────────────────────────────
INSERT INTO "scope_sheet_family" ("id", "name", "is_default", "updated_at") VALUES
  ('inspection-certification', 'Inspection & certification', false, NOW()),
  ('logistics-clearance',     'Logistics & clearance',      false, NOW()),
  ('project-advisory',        'Project & advisory',         false, NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 4 · Order, and the credential each prompts ────────────────────────────
--
-- B3: **prompted, never gating.** Nothing reads this column on a publish path.
--
-- Professional services is null and `4e-s` Q3 is why: its column reads
-- *Regulator-dependent*, and the regulator depends on the subcategory — the FTA
-- for tax, the Ministry of Finance for audit, ADGM or DIFC for legal. That is a
-- lookup this platform does not have, and prompting a law firm for an FTA tax
-- agent number is worse than prompting it for nothing.
--
-- On-site maintenance and Project & advisory are null because the board's own
-- column says *trade licence only* — and the trade licence is on `business`,
-- not a `credential` row (`8b-s`), so there is nothing extra to prompt for.
UPDATE "scope_sheet_family" SET "position" = 0, "credential_kind" = NULL              WHERE "id" = 'professional-services';
UPDATE "scope_sheet_family" SET "position" = 1, "credential_kind" = NULL              WHERE "id" = 'on-site-maintenance';
UPDATE "scope_sheet_family" SET "position" = 2, "credential_kind" = 'professional_body' WHERE "id" = 'inspection-certification';
UPDATE "scope_sheet_family" SET "position" = 3, "credential_kind" = 'other'           WHERE "id" = 'logistics-clearance';
UPDATE "scope_sheet_family" SET "position" = 4, "credential_kind" = NULL              WHERE "id" = 'project-advisory';
-- The fallback sorts last and is not one of the five.
UPDATE "scope_sheet_family" SET "position" = 9 WHERE "id" = 'general';

-- ── 5 · Fee bases, per family and never a global list ─────────────────────
--
-- B2, and the board names it as the single most likely build error: *offering
-- "per container" to a tax practice is the same failure as offering "stock
-- level" to a service seller.* `3g-s` B2 validates a service's fee basis
-- against its own family's list server-side, and this is the list.
INSERT INTO "scope_sheet_fee_basis" ("family_id", "key", "label", "position") VALUES
  ('professional-services', 'per_return',   'Per return',   0),
  ('professional-services', 'per_filing',   'Per filing',   1),
  ('professional-services', 'retainer',     'Retainer',     2),
  ('professional-services', 'per_hour',     'Per hour',     3),
  ('professional-services', 'fixed_fee',    'Fixed fee',    4),

  ('on-site-maintenance', 'per_month',    'Per month',        0),
  ('on-site-maintenance', 'per_visit',    'Per visit',        1),
  ('on-site-maintenance', 'per_sqft_yr',  'Per sq ft / yr',   2),
  ('on-site-maintenance', 'per_job',      'Per job',          3),
  ('on-site-maintenance', 'on_assessment','On assessment',    4),

  ('inspection-certification', 'per_visit',       'Per visit',       0),
  ('inspection-certification', 'per_certificate', 'Per certificate', 1),
  ('inspection-certification', 'per_asset',       'Per asset',       2),
  ('inspection-certification', 'fixed_fee',       'Fixed fee',       3),

  ('logistics-clearance', 'per_container',   'Per container',   0),
  ('logistics-clearance', 'per_shipment',    'Per shipment',    1),
  ('logistics-clearance', 'per_declaration', 'Per declaration', 2),
  ('logistics-clearance', 'per_kg',          'Per kg',          3),

  ('project-advisory', 'fixed_fee',            'Fixed fee',            0),
  ('project-advisory', 'per_phase',            'Per phase',            1),
  -- `4e-s` Q4. The seller's own fee structure, and the platform takes nothing
  -- either way — the seller-facing label says whose percentage it is, because
  -- on a no-commission directory somebody will otherwise read it as our cut.
  ('project-advisory', 'percentage_of_value',  'A percentage of the value (yours, not ours)', 2),
  ('project-advisory', 'on_assessment',        'On assessment',        3)
ON CONFLICT ("family_id", "key") DO NOTHING;

-- ── 6 · The public rows, in the order `1g-s` renders them ─────────────────
--
-- B4: **the six required fields are platform-level and a family cannot touch
-- them.** They are columns on `service`, not rows here, which is what makes
-- that true by construction rather than by review — a family adds optional
-- rows and can do nothing else.
--
-- B7: `1g-s` reads this order, so every firm in a family renders the same table
-- in the same order. That is the comparison the directory exists for.
INSERT INTO "scope_sheet_row" ("family_id", "key", "label", "position", "filterable") VALUES
  ('inspection-certification', 'engagement_type',      'Engagement type',        0, false),
  ('inspection-certification', 'turnaround',           'Turnaround',             1, true),
  ('inspection-certification', 'fee_basis',            'Fee basis',              2, true),
  ('inspection-certification', 'deliverable',          'What you receive',       3, false),
  ('inspection-certification', 'delivered_where',      'Where it happens',       4, true),
  ('inspection-certification', 'regulator',            'Accreditation',          5, true),
  ('inspection-certification', 'requires_from_client', 'What we need from you',  6, false),
  ('inspection-certification', 'sectors',              'Assets inspected',       7, true),
  ('inspection-certification', 'languages',            'Report languages',       8, false),

  ('logistics-clearance', 'engagement_type',      'Engagement type',         0, false),
  ('logistics-clearance', 'turnaround',           'Clearance time',          1, true),
  ('logistics-clearance', 'fee_basis',            'Fee basis',               2, true),
  ('logistics-clearance', 'deliverable',          'What you receive',        3, false),
  ('logistics-clearance', 'delivered_where',      'Where it happens',        4, true),
  ('logistics-clearance', 'regulator',            'Customs code',            5, true),
  ('logistics-clearance', 'requires_from_client', 'Documents you provide',   6, false),
  ('logistics-clearance', 'sectors',              'Cargo handled',           7, true),
  ('logistics-clearance', 'languages',            'Languages',               8, false),

  ('project-advisory', 'engagement_type',      'Engagement type',        0, false),
  ('project-advisory', 'turnaround',           'Turnaround',             1, true),
  ('project-advisory', 'fee_basis',            'Fee basis',              2, true),
  ('project-advisory', 'deliverable',          'What you receive',       3, false),
  ('project-advisory', 'delivered_where',      'Where it happens',       4, true),
  ('project-advisory', 'regulator',            'Standard applied',       5, true),
  ('project-advisory', 'requires_from_client', 'What we need from you',  6, false),
  ('project-advisory', 'sectors',              'Sectors worked in',      7, true),
  ('project-advisory', 'languages',            'Languages',              8, false)
ON CONFLICT ("family_id", "key") DO NOTHING;

-- ── 7 · What a firm in each trade usually sells — `8c-s` B8's seed list ───
INSERT INTO "scope_sheet_common_service" ("family_id", "name", "position") VALUES
  ('inspection-certification', 'Pre-purchase inspection',        0),
  ('inspection-certification', 'Statutory inspection',           1),
  ('inspection-certification', 'ISO certification audit',        2),
  ('inspection-certification', 'Third-party witness testing',    3),
  ('inspection-certification', 'Condition survey',               4),

  ('logistics-clearance', 'Customs clearance',          0),
  ('logistics-clearance', 'Freight forwarding',         1),
  ('logistics-clearance', 'Import documentation',       2),
  ('logistics-clearance', 'Export documentation',       3),
  ('logistics-clearance', 'Bonded warehousing',         4),

  ('project-advisory', 'Feasibility study',             0),
  ('project-advisory', 'Management consultancy',        1),
  ('project-advisory', 'Business valuation',            2),
  ('project-advisory', 'Due diligence',                 3),
  ('project-advisory', 'Corporate training',            4)
ON CONFLICT ("family_id", "name") DO NOTHING;

-- ── 8 · Assign the services subcategories ─────────────────────────────────
--
-- **39, not the board's 420.** `Category.tradeKind` is null on 434 of 440 rows:
-- `4d-s` shipped the column and the resolver and classified six, so the walk
-- resolves 39 leaves to services and everything else to goods. Assigning 420
-- would mean first inventing 381 classifications, which is `4d-s`'s job and not
-- a number this board may make up.
--
-- Assigned by name against the trades each family covers, and anything this
-- misses stays null — which B6 says is a real state rather than an error, and
-- the admin screen counts it so somebody can clear it.
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "scope_family_id" IS NULL AND (
   "name" IN ('Accounting & bookkeeping','Audit & assurance','Corporate tax compliance','Excise tax',
              'Internal audit','Outsourced CFO services','Transfer pricing','VAT & tax advisory',
              'Arbitration & dispute resolution','Contract drafting & review','Employment law',
              'Legal consultancy','Notary & legalisation','Real estate & conveyancing',
              'Trademark & IP','Translation & attestation','Company formation','Company liquidation',
              'Corporate bank account opening','ESR & UBO compliance','Free zone company setup',
              'Mainland company setup','Offshore company setup','PRO services','Trade licence renewal',
              'Visa & immigration','HR & payroll','Debt collection','Insurance brokerage'));

UPDATE "category" SET "scope_family_id" = 'logistics-clearance'
 WHERE "scope_family_id" IS NULL AND "name" IN ('Customs clearance','Freight forwarding');

UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "scope_family_id" IS NULL AND "name" IN ('ISO certification & consultancy');

UPDATE "category" SET "scope_family_id" = 'project-advisory'
 WHERE "scope_family_id" IS NULL AND (
   "name" IN ('Business & asset valuation','Corporate training','Due diligence',
              'Management consultancy','Cybersecurity','Event management','Recruitment agencies'));

-- ── 9 · Trim the two renamed families to the authored set ─────────────────
--
-- The renamed pair kept the fee bases they were authored with, so each ended up
-- a superset of the board's list — `on_assessment` on Professional services,
-- `fixed_fee` on On-site maintenance. AC2 says the family's list is the only
-- source of fee-basis options, so the list has to be the authored one.
--
-- **Only where nothing holds the value.** That is B9's rule doing its own job:
-- a basis in use by a live service is kept and flagged rather than removed,
-- because clearing a seller's fee basis to tidy a taxonomy is the silent write
-- B9 exists to forbid.
DELETE FROM "scope_sheet_fee_basis" b
 WHERE b."family_id" = 'professional-services'
   AND b."key" = 'on_assessment'
   AND NOT EXISTS (
     SELECT 1 FROM "service" s
      JOIN "category" c ON c."id" = s."category_id"
     WHERE s."fee_basis" = b."key" AND c."scope_family_id" = b."family_id"
   );

DELETE FROM "scope_sheet_fee_basis" b
 WHERE b."family_id" = 'on-site-maintenance'
   AND b."key" = 'fixed_fee'
   AND NOT EXISTS (
     SELECT 1 FROM "service" s
      JOIN "category" c ON c."id" = s."category_id"
     WHERE s."fee_basis" = b."key" AND c."scope_family_id" = b."family_id"
   );

-- Positions renumbered so the label order matches the board's table.
UPDATE "scope_sheet_fee_basis" SET "position" = 0 WHERE "family_id" = 'professional-services' AND "key" = 'per_return';
UPDATE "scope_sheet_fee_basis" SET "position" = 1 WHERE "family_id" = 'professional-services' AND "key" = 'per_filing';
UPDATE "scope_sheet_fee_basis" SET "position" = 2 WHERE "family_id" = 'professional-services' AND "key" = 'retainer';
UPDATE "scope_sheet_fee_basis" SET "position" = 3 WHERE "family_id" = 'professional-services' AND "key" = 'per_hour';
UPDATE "scope_sheet_fee_basis" SET "position" = 4 WHERE "family_id" = 'professional-services' AND "key" = 'fixed_fee';
