-- The business match surface. See `Business.searchText` in schema.prisma.
--
-- Deliberately no SQL backfill. Building this column means expanding sizes
-- (DN100 ↔ 4"), trade abbreviations and pressure classes, and that table lives
-- in lib/trade/nominal-size.ts. Writing it a second time in SQL is exactly the
-- duplication that file already carries a note about, and a half-normalised
-- backfill is worse than an honest null: it would look indexed and silently
-- miss the spellings the whole feature exists to catch.
--
-- Existing rows are filled by `pnpm reindex`, which runs the real function.
-- Until then null reads as empty — never as "matches everything".

-- AlterTable
ALTER TABLE "business" ADD COLUMN     "search_text" TEXT;

-- CreateIndex
CREATE INDEX "business_search_text_idx" ON "business" USING GIN ("search_text" gin_trgm_ops);
