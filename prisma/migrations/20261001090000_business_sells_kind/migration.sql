-- Board `2b-s`, decision D8: what a seller says they sell.
--
-- The second half of the fork. `4d-s` shipped `Category.tradeKind` — a fact
-- about a trade — and this is the business's own declaration, which is a
-- different question with a different job.
--
--   · `Category.tradeKind` decides how one listing renders.
--   · `Business.sellsKind`  decides which onboarding the seller gets, which
--     dashboard nav they see, and which setup tasks appear.
--
-- WHY `both` LIVES HERE AND NOT ON `trade_kind`
--
-- A firm that supplies equipment and services it is ordinary. On the category a
-- third value would let a subcategory be neither, and ~40 consumers would grow
-- a branch for a state the taxonomy cannot act on. On the business it is the
-- plain truth, and it is what sizes the setup honestly — "roughly twice the
-- setup, so pick it only if you mean it". It introduces no third model: the
-- business holds subcategories of both kinds and each listing renders per its
-- own.
--
-- WHY `unset` IS A VALUE RATHER THAN A NULLABLE COLUMN
--
-- The same argument `4d-s` made for having no default on `trade_kind`, in the
-- other direction. Here the absence is not "inherit from somewhere" — there is
-- nowhere to inherit from — it is "nobody has been asked yet", and onboarding
-- has to route back to the question. A nullable column would say the same
-- thing, but an enum member says it in the type: every reader has to handle
-- `unset` explicitly rather than deciding for itself what `null` means.
--
-- Existing rows all become `unset`, which is honest. There are no live sellers
-- who answered this, and inferring it onto them is exactly the `offering_type`
-- mistake the service track was created to avoid — board `2b-s` Q3 answers it:
-- an existing seller is shown the screen once, never migrated by guess.
--
-- ADDITIVE, SO IT APPLIES BEFORE THE MERGE
--
-- `docs/deployments.md` § Ordering. The column has a default, so every existing
-- row is valid the moment it exists and no code reads it until the deploy that
-- ships alongside.
--
-- IDEMPOTENT, AND SAFE TO RUN TWICE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The four states
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Declaration order is sort order in Postgres, and `unset` is declared first so
-- that any ordering puts the businesses nobody has asked at the top — the same
-- reason `4d-s` sorts its unset rows first.

DO $$ BEGIN
  CREATE TYPE "sells_kind" AS ENUM ('unset', 'goods', 'services', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The column
-- ─────────────────────────────────────────────────────────────────────────────
--
-- No index. Onboarding reads it for one business at a time by primary key, and
-- the only whole-table question — how many sellers have answered — is a count
-- over a few thousand rows that no screen asks on a hot path.

ALTER TABLE "business"
  ADD COLUMN IF NOT EXISTS "sells_kind" "sells_kind" NOT NULL DEFAULT 'unset';
