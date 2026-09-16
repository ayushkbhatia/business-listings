-- Boards `10c` + `10c-s` — a saved search may be a blended one, and the CHECK
-- did not know it.
--
-- `saved_search.tab` records which results page the search was saved on, so the
-- sweep counts it with that page's predicate. `1c-s` added a third value, `all`,
-- for the blended page — `tabOf()` returns it, `storedTab()` reads it back, and
-- `countMatches()` routes it to `countBlended`. The CHECK written by board `10e`
-- the week before still allowed only the two goods values:
--
--     CHECK ("tab" IN ('businesses', 'products'))
--
-- Nothing hit it, because the blended page only rendered for words that found a
-- live service and production has none. `10c`'s D1 sends every query with words
-- to that page, so every save from `/search` now carries `kind=` and resolves to
-- `all` — and the save failed with
-- `new row for relation "saved_search" violates check constraint`.
--
-- ## Ordering
--
-- **Before the merge that reads it.** Widening a CHECK accepts everything the
-- old one did, so the deployment now live is unaffected: it writes only
-- `businesses` and `products`, and both still pass. Applying it after the merge
-- would leave the window in which the new code writes `all` and the database
-- refuses it — which is the failure this migration exists to close.
--
-- No backfill. No row holds `all` yet, because none could.
ALTER TABLE "saved_search" DROP CONSTRAINT IF EXISTS "saved_search_tab_known";
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_tab_known"
  CHECK ("tab" IN ('businesses', 'products', 'all'));
