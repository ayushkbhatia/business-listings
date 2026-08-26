-- Handoff 4, step 7. Board 6f: the SEO page matrix.
--
-- Category landing pages have a heading and a grid of results and nothing else.
-- `Category.publishThreshold` and `verifiedShareMin` have gated their publishing
-- since handoff 0, and `thresholdsFor` carries a third gate — 250 intro words —
-- that has never been measurable, because there was nowhere for the copy to be.
--
-- `lib/taxonomy/service.ts` says so in as many words: "the word count is a
-- property of the page's copy, not of the category, so board 6f owns it in step
-- 7." This is that column.

ALTER TABLE "category" ADD COLUMN "intro" TEXT;
