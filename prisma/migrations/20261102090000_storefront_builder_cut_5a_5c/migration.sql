-- Boards `5a`, `5b`, `5c` — the storefront builder, cut 15 Sep 2026. The template tables.
--
-- The code that read these went first (#214, live): no route, service, loader,
-- seed or test touches `storefront_template`, `template_section`,
-- `storefront_content`, `template_page` or `template_version`, and nothing
-- counts or includes the relations that pointed at them. This drops them.
--
-- What production held when it was written (queried 15 Sep 2026): two live
-- templates, both seeded (Industrial, Stockist); 16 sections; 0 seller content
-- rows; two seeded "About us" pages; two versions; 0 audit rows naming a
-- template. Nothing a person authored is in it.
--
-- `template_status` stays: `spec_template` shares it.
--
-- ## Not in here: `business.theme_preset` and `business.theme_hex`
--
-- They were, and that version had no safe order. The deployed client still
-- declares both fields, and `getBusinessBySlug` loads a business with `include`
-- and no `select`, so Prisma names every scalar column — dropping them under
-- that deployment returns 500 on every storefront. The schema in this PR stops
-- declaring them; the columns drop in the next migration, once this is live.
--
-- ## Ordering
--
-- **Apply before this PR merges.** The running deployment reads none of these
-- tables, and `check:schema-deployed` refuses this PR's production build until
-- the migration is recorded.
--
-- Idempotent: a second run is a no-op.

DROP TABLE IF EXISTS "storefront_content";
DROP TABLE IF EXISTS "template_version";
DROP TABLE IF EXISTS "template_page";
DROP TABLE IF EXISTS "template_section";
DROP TABLE IF EXISTS "storefront_template";

DROP FUNCTION IF EXISTS storefront_template_sector_is_top_level();

DROP TYPE IF EXISTS "template_density";
DROP TYPE IF EXISTS "type_pairing";
