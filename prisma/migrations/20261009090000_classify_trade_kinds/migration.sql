-- Classifying the taxonomy — board `4d-s`'s column, filled in, and `4e-s` B5.
--
-- `4d-s` shipped `Category.tradeKind`, the ancestor walk that resolves it, and
-- six classifications. The other 434 rows resolved to `goods` by default, so a
-- directory that is roughly half services had 39 services subcategories — and
-- every board downstream was correct against a taxonomy that was not.
--
-- **Data only.** No column is added, dropped or re-typed, and the classification
-- is a one-time backfill: production's taxonomy stays ops' to maintain through
-- the admin screens, where each write is audited with a reason. A taxonomy
-- decision must not cost a deploy.
--
-- The list and the rule it was applied by live in `prisma/trade-kinds.mts`,
-- which the seed reads too, so this file and the fixture cannot disagree about
-- what a trade is. Regenerate rather than hand-edit.
--
-- Idempotent: every statement is an absolute `SET`, so running it twice lands
-- in the same place.

-- ── 1 · The thirteen sectors ──────────────────────────────────────────────
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'construction-and-building-materials';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'electrical-and-cable';
UPDATE "category" SET "trade_kind" = 'services' WHERE "slug" = 'facilities-management-and-cleaning';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'hvac-and-ventilation';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'it-telecom-and-software';
UPDATE "category" SET "trade_kind" = 'services' WHERE "slug" = 'legal-audit-and-business-setup';
UPDATE "category" SET "trade_kind" = 'services' WHERE "slug" = 'logistics-and-freight';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'packaging-and-materials';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'pipes-and-tubing';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'printing-signage-and-events';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'pumps-and-motors';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'safety-and-ppe';
UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'valves-and-fittings';

-- ── 2 · The seventy subcategories that disagree with their sector ────────
UPDATE "category" SET "trade_kind" = 'services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'construction-and-building-materials')
   AND "name" IN ('Architectural & engineering design', 'Asphalt & road works', 'Civil contracting', 'Demolition & dismantling', 'Heavy equipment rental', 'Interior fit-out', 'MEP contracting', 'Piling & foundations', 'Project management', 'Quantity surveying', 'Shoring & excavation support', 'Soil & material testing', 'Surveying & setting out', 'Swimming pool construction', 'Waterproofing');

UPDATE "category" SET "trade_kind" = 'services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'electrical-and-cable')
   AND "name" IN ('Cable jointing & termination', 'Electrical testing');

UPDATE "category" SET "trade_kind" = 'goods'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'facilities-management-and-cleaning')
   AND "name" IN ('Office furniture');

UPDATE "category" SET "trade_kind" = 'services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'hvac-and-ventilation')
   AND "name" IN ('District cooling services', 'Duct cleaning', 'Energy audits & retrofit', 'HVAC maintenance AMC', 'HVAC water treatment', 'Testing & commissioning');

UPDATE "category" SET "trade_kind" = 'services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software')
   AND "name" IN ('AI & automation services', 'Backup & disaster recovery', 'Cloud & hosting', 'CRM software', 'Cybersecurity', 'Data analytics & BI', 'Digital transformation consulting', 'E-commerce platforms', 'ERP & accounting software', 'HR & payroll software', 'IT relocation & installation', 'IT staffing & outsourcing', 'IT support & AMC', 'Mobile app development', 'Software development', 'Software licensing', 'Structured cabling', 'Telecom services', 'Web design & development');

UPDATE "category" SET "trade_kind" = 'goods'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight')
   AND "name" IN ('Container sales & leasing', 'Material handling equipment');

UPDATE "category" SET "trade_kind" = 'services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'pipes-and-tubing')
   AND "name" IN ('Pipe coating & lining', 'Pipe testing & inspection', 'Pipe threading & cutting');

UPDATE "category" SET "trade_kind" = 'services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'printing-signage-and-events')
   AND "name" IN ('3D printing & prototyping', 'AV, staging & lighting', 'Binding & finishing', 'Catering equipment rental', 'Copywriting & translation', 'Digital marketing', 'Engraving & laser cutting', 'Event furniture rental', 'Event management', 'Event staffing', 'Exhibition stands', 'Graphic design & branding', 'Photography & video', 'PR & communications', 'Shop fitting & retail displays', 'Tents & marquees', 'Vehicle branding & wraps', 'Video & film production');

UPDATE "category" SET "trade_kind" = 'services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'safety-and-ppe')
   AND "name" IN ('Extinguisher refilling', 'HSE consultancy', 'Safety training', 'Traffic management');

UPDATE "category" SET "trade_kind" = 'goods' WHERE "slug" = 'servers-and-storage';

-- ── 3 · A scope sheet for every services subcategory ─────────────────────
UPDATE "category" c SET "scope_family_id" = 'project-advisory'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'construction-and-building-materials')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Heavy equipment rental', 'Soil & material testing', 'Surveying & setting out')
;
UPDATE "category" SET "scope_family_id" = 'on-site-maintenance'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'construction-and-building-materials') AND "name" = 'Heavy equipment rental';
UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'construction-and-building-materials') AND "name" = 'Soil & material testing';
UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'construction-and-building-materials') AND "name" = 'Surveying & setting out';

UPDATE "category" c SET "scope_family_id" = 'on-site-maintenance'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'electrical-and-cable')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Electrical testing')
;
UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'electrical-and-cable') AND "name" = 'Electrical testing';

UPDATE "category" c SET "scope_family_id" = 'on-site-maintenance'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'facilities-management-and-cleaning')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Building inspection & snagging', 'Office moving')
;
UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'facilities-management-and-cleaning') AND "name" = 'Building inspection & snagging';
UPDATE "category" SET "scope_family_id" = 'logistics-clearance'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'facilities-management-and-cleaning') AND "name" = 'Office moving';

UPDATE "category" c SET "scope_family_id" = 'on-site-maintenance'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'hvac-and-ventilation')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Energy audits & retrofit', 'Testing & commissioning')
;
UPDATE "category" SET "scope_family_id" = 'project-advisory'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'hvac-and-ventilation') AND "name" = 'Energy audits & retrofit';
UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'hvac-and-ventilation') AND "name" = 'Testing & commissioning';

UPDATE "category" c SET "scope_family_id" = 'project-advisory'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Backup & disaster recovery', 'CRM software', 'Cloud & hosting', 'ERP & accounting software', 'HR & payroll software', 'IT staffing & outsourcing', 'IT support & AMC', 'Software licensing', 'Telecom services')
;
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'Backup & disaster recovery';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'CRM software';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'Cloud & hosting';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'ERP & accounting software';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'HR & payroll software';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'IT staffing & outsourcing';
UPDATE "category" SET "scope_family_id" = 'on-site-maintenance'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'IT support & AMC';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'Software licensing';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'it-telecom-and-software') AND "name" = 'Telecom services';

UPDATE "category" c SET "scope_family_id" = 'professional-services'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'legal-audit-and-business-setup')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
;

UPDATE "category" c SET "scope_family_id" = 'logistics-clearance'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Cargo inspection & survey', 'Cargo insurance', 'Crane hire & rigging', 'Fleet management', 'Supply chain consultancy', 'Warehouse management systems')
;
UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight') AND "name" = 'Cargo inspection & survey';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight') AND "name" = 'Cargo insurance';
UPDATE "category" SET "scope_family_id" = 'project-advisory'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight') AND "name" = 'Crane hire & rigging';
UPDATE "category" SET "scope_family_id" = 'on-site-maintenance'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight') AND "name" = 'Fleet management';
UPDATE "category" SET "scope_family_id" = 'project-advisory'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight') AND "name" = 'Supply chain consultancy';
UPDATE "category" SET "scope_family_id" = 'project-advisory'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'logistics-and-freight') AND "name" = 'Warehouse management systems';

UPDATE "category" c SET "scope_family_id" = 'project-advisory'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'pipes-and-tubing')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Pipe testing & inspection')
;
UPDATE "category" SET "scope_family_id" = 'inspection-certification'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'pipes-and-tubing') AND "name" = 'Pipe testing & inspection';

UPDATE "category" c SET "scope_family_id" = 'project-advisory'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'printing-signage-and-events')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('Copywriting & translation', 'Digital marketing', 'Event staffing', 'PR & communications')
;
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'printing-signage-and-events') AND "name" = 'Copywriting & translation';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'printing-signage-and-events') AND "name" = 'Digital marketing';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'printing-signage-and-events') AND "name" = 'Event staffing';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'printing-signage-and-events') AND "name" = 'PR & communications';

UPDATE "category" c SET "scope_family_id" = 'on-site-maintenance'
 WHERE c."parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'safety-and-ppe')
   AND NOT EXISTS (SELECT 1 FROM "category" k WHERE k."parent_id" = c."id")
   AND COALESCE(c."trade_kind", (SELECT p."trade_kind" FROM "category" p WHERE p."id" = c."parent_id")) = 'services'
   AND c."name" NOT IN ('HSE consultancy', 'Safety training')
;
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'safety-and-ppe') AND "name" = 'HSE consultancy';
UPDATE "category" SET "scope_family_id" = 'professional-services'
 WHERE "parent_id" = (SELECT "id" FROM "category" WHERE "slug" = 'safety-and-ppe') AND "name" = 'Safety training';

