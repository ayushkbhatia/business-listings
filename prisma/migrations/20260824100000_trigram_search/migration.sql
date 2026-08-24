-- Search indexes that match the query the directory actually runs.
--
-- The initial indexes were GIN over to_tsvector. Full-text search stems and
-- tokenises, which is wrong for this data: a buyer types `DN100` or `4"` and
-- means an exact substring of a machine string, and `4"` is not even a legal
-- tsquery. Trigram indexes accelerate ILIKE '%…%', which is the query shape
-- that finds a product whose seller typed 4" from a search for DN100.
--
-- Every statement is idempotent. This migration replaces an earlier one that
-- Prisma generated as DROP-only — `migrate dev` applied a handwritten file,
-- then wrote a second migration dropping the indexes it had just created,
-- because indexes declared in raw SQL are invisible to schema.prisma. The
-- result was a history that dropped indexes on a fresh database and left
-- production with none at all. Raw-SQL indexes have to be written so replaying
-- them is safe.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS "product_search_text_idx";
DROP INDEX IF EXISTS "business_display_name_idx";

CREATE INDEX IF NOT EXISTS "product_search_text_trgm_idx"
  ON "product" USING gin ("search_text" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "business_display_name_trgm_idx"
  ON "business" USING gin ("display_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "business_trade_name_trgm_idx"
  ON "business" USING gin ("trade_name" gin_trgm_ops);

-- Category synonyms are matched exactly — an Arabic term either is or is not
-- in the list — so a GIN index on the array is the right shape there.
CREATE INDEX IF NOT EXISTS "category_synonyms_idx"
  ON "category" USING gin ("synonyms");
