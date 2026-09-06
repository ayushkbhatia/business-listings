-- Board 3h — clearing the flag that deleted catalogue data.
--
-- `SellerTemplate.fieldMappings` carried a per-field `hidden` boolean, written
-- by a checkbox on /dashboard/templates that was offered on every field
-- including the filterable ones. It was documented as label-only and
-- buyer-invisible, and `lib/db/queries/storefront-catalogue.ts` refuses to read
-- it for exactly that reason. It was neither:
--
--   1. board 3g's product editor rendered inputs for un-hidden fields only;
--   2. `saveProduct` rebuilt `Product.specValues` from the boxes the form
--      posted and wrote the result wholesale;
--   3. so hiding a field and then saving any product deleted that field's
--      stored value from it.
--
-- `specValues` feeds `Business.specCompleteness`, which is twelve of the
-- hundred points in `lib/search/ranking.ts`, and the spec table every buyer
-- reads on a product page. The control's only intended effect was to make a
-- seller harder to find; its actual effect was to destroy their data and their
-- search position, while the rename warning on the same screen promised nothing
-- would be lost.
--
-- The control, its writer and its one reader are gone in this commit.
-- `saveProduct` merges over the stored values now, so the same hole cannot
-- reopen the next time a screen renders a partial field set. This clears the
-- flags already written, so a seller who used it is not left with a template
-- carrying a key nothing reads.
--
-- Data only. No column is added, dropped or retyped, so it applies safely
-- before the merge like every other additive migration
-- (docs/deployments.md § Ordering).
--
-- What is deliberately NOT here: the spec values already deleted. They are
-- gone — the write replaced the JSON rather than patching it, so there is
-- nothing to recover from the row, and no audit trail of product edits to
-- reconstruct them from. A seller who hid a field and saved products since
-- refills those fields, and the flag count below is what tells us how many
-- sellers to expect.

UPDATE "seller_template" AS st
SET "field_mappings" = (
  SELECT COALESCE(
    jsonb_object_agg(entry.key, entry.value - 'hidden')
      FILTER (WHERE (entry.value - 'hidden') <> '{}'::jsonb),
    '{}'::jsonb
  )
  FROM jsonb_each(st."field_mappings"::jsonb) AS entry
)
WHERE st."field_mappings"::jsonb @? '$.*.hidden';
