-- Board `5b` — the seller theme presets, cut 15 Sep 2026. The two columns they left.
--
-- `business.theme_preset` was written only by the seed and the builder's
-- custom-hex path; `business.theme_hex` was never read or written by anything.
-- Production held 4 seed-written presets and 0 hex values (15 Sep 2026).
--
-- ## Ordering
--
-- **After the deployment that stopped declaring them is live, and before this
-- PR merges.** That is the template-table cut (`20261102090000_storefront_builder_cut_5a_5c`),
-- whose schema no longer carries `themePreset` or `themeHex`.
--
-- Not before. Any deployment whose Prisma client still declares the fields
-- names both columns whenever it loads a business without a `select` —
-- `getBusinessBySlug` does, with `include` — so dropping them under that
-- deployment returns 500 on every storefront. That is why these were split out
-- of the template migration rather than dropped with it.
--
-- `DROP COLUMN` in Postgres marks the column dead without rewriting the table,
-- so the lock on `business` is brief.
--
-- Idempotent: a second run is a no-op.

ALTER TABLE "business"
  DROP COLUMN IF EXISTS "theme_preset",
  DROP COLUMN IF EXISTS "theme_hex";
