-- `business.sector_id` maintains itself.
--
-- The column landed in `20260827120000_storefront_templates` with the rule that
-- everything writing `primary_category_id` writes it too. There were two such
-- places in the application and both were wired — and the assertion that walks
-- the table still failed the first time the whole suite ran, because a dozen
-- test fixtures create listings directly.
--
-- That is the argument against the rule rather than against the fixtures. The
-- value is a pure function of another column in the same row, so Postgres can
-- keep it, and then there is no fifth writer to forget. The application code
-- that was setting it has been removed: two mechanisms for one value is one
-- mechanism too many, and the silently redundant one is the one that rots.

CREATE OR REPLACE FUNCTION business_sector_from_category()
RETURNS TRIGGER AS $$
DECLARE
  current_id TEXT := NEW.primary_category_id;
  parent     TEXT;
  hops       INTEGER := 0;
BEGIN
  -- Bounded. `onDelete: Restrict` and the taxonomy screen both make a cycle
  -- hard; neither makes it impossible, and a cycle here would hang every write
  -- to the business table.
  LOOP
    SELECT parent_id INTO parent FROM category WHERE id = current_id;
    EXIT WHEN parent IS NULL OR hops >= 8;
    current_id := parent;
    hops := hops + 1;
  END LOOP;

  NEW.sector_id := current_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "business_sector_from_category"
  BEFORE INSERT OR UPDATE OF "primary_category_id" ON "business"
  FOR EACH ROW EXECUTE FUNCTION business_sector_from_category();

-- Rows that already exist, including any written between the two migrations.
WITH RECURSIVE roots AS (
  SELECT id, parent_id, id AS root_id FROM category WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, r.root_id FROM category c JOIN roots r ON c.parent_id = r.id
)
UPDATE "business" b
SET "sector_id" = r.root_id
FROM roots r
WHERE b."primary_category_id" = r.id
  AND b."sector_id" IS DISTINCT FROM r.root_id;
