-- Board 8b: what a photograph is filed under, and a Free cap that is not a wall.
--
-- Every statement is IF NOT EXISTS or idempotent by construction. A hand-written
-- migration in this repo has to be, or a later `prisma migrate dev` regenerates
-- it as a drop — the indexes on `licence_import_run` were lost that way once.

-- ── Which suggested slot the seller filed this photograph under ─────────────
--
-- "Your team at work", "Delivery vehicle". A prompt rather than a required
-- field, and the thing that gives a photograph a name on the grid instead of
-- IMG_4471.jpg.
--
-- It is deliberately NOT a claim about the pixels. The green line under a tile
-- is the slot's own static copy, shown because the seller filed it there;
-- nothing in this build looks at image content. Keeping the two apart is the
-- single instruction board 8b repeats, because one visual treatment covers both.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "slot_key" TEXT;

-- ── The grid read ───────────────────────────────────────────────────────────
--
-- `media` had @@index([business_id]) and nothing on kind or order, while two
-- production queries have ordered by sort_order since handoff 1.
CREATE INDEX IF NOT EXISTS "media_business_id_kind_sort_order_idx"
  ON "media"("business_id", "kind", "sort_order");

-- ── Exactly one cover per business ──────────────────────────────────────────
--
-- The cover is `kind = 'cover'`, which is what lib/storefront/loader.ts already
-- reads, so promoting a photograph is a kind change and no new column. "Exactly
-- one" is enforced by the service in a transaction — demote, then promote — and
-- this partial unique is the fence under it: two tabs, or a retry, cannot leave
-- a listing with two covers and a storefront picking whichever row sorted first.
--
-- Partial, so it says nothing about gallery rows, of which there are many.
CREATE UNIQUE INDEX IF NOT EXISTS "media_one_cover_per_business_idx"
  ON "media"("business_id")
  WHERE "kind" = 'cover' AND "business_id" IS NOT NULL;

-- ── The Free photograph cap ─────────────────────────────────────────────────
--
-- Five, against a task that asks for five and a count that includes the logo:
-- a Free seller with a logo had four slots, could never reach the target, and
-- task 1 of the setup hub was uncompletable for them. That is the same defect
-- board 8a found in the team task, where the invite flow could not complete and
-- capped a real seller at 90 points.
--
-- Thirty is board 8b §2's own figure. Guarded on the old value so it corrects
-- the seeded default and never overwrites a number somebody has since chosen.
UPDATE "plan" SET "photo_limit" = 30 WHERE "id" = 'free' AND "photo_limit" = 5;
