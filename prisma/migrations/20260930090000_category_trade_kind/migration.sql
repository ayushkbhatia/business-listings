-- D5, decided 9 Sep 2026: whether a trade is sold by the item or by the job.
--
-- The fork. Roughly forty screens read this column, so it is the first thing
-- the service track needs and the thing every `-s` board inherits an error
-- from. `docs/services-build-plan.md` stage 2.
--
-- WHY THE SUBCATEGORY AND NOT THE SECTOR
--
-- Not one of the thirteen sectors is purely one or the other, and a
-- sector-level flag would be wrong on roughly half the tree. The seed proves
-- it: *Logistics & freight forwarding* holds `customs-clearance` beside
-- `material-handling-equipment`; *IT, telecom & software* holds `cybersecurity`
-- beside `servers-and-storage`; *Printing, signage & events* holds
-- `event-management` beside `corporate-gifts-and-merchandise`. Only *Legal,
-- audit & business setup* is clean, and it is clean in the services direction.
--
-- So the unit is the subcategory. There are 427 of them under 13 sectors, 440
-- `category` rows in all.
--
-- WHY NULLABLE, AND WHY NO DEFAULT
--
-- Null means "inherit from the parent", which is what makes 440 rows setable in
-- an afternoon rather than one at a time: a sector set once covers every child
-- that does not disagree. `resolveTradeKind` in `lib/taxonomy/trade-kind.ts`
-- walks up to the nearest ancestor holding a value, and a tree with none
-- anywhere resolves to `goods` — in code, not in the column.
--
-- That fallback belongs in code rather than in a column default for one reason:
-- a default would make every row say `goods` out loud, and the ops screen could
-- never tell a sector somebody has decided about from one nobody has looked at
-- yet. The screen shows SET, INHERITED and NOT SET as three different things,
-- and it can only do that while null survives the write.
--
-- ADDITIVE, SO IT APPLIES BEFORE THE MERGE
--
-- `docs/deployments.md` § Ordering. Nothing reads the column until the code
-- that ships alongside it, and the code tolerates every row being null —
-- which, immediately after this runs, every row is.
--
-- IDEMPOTENT, AND SAFE TO RUN TWICE
--
-- Both statements guard themselves, so a database that already has the type or
-- the column is left alone rather than failing the deploy.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The two kinds
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Two values and deliberately no third. "Both" is a property of a business and
-- not of a trade: a firm that sells pumps and services them holds one category
-- of each, which `business_category` already expresses. A `both` value here
-- would let one subcategory be neither, and every reader would grow a branch
-- for a state the taxonomy cannot act on.
--
-- Declaration order is sort order in Postgres. `goods` first, because it is the
-- fallback and the larger half of the directory.

DO $$ BEGIN
  CREATE TYPE "trade_kind" AS ENUM ('goods', 'services');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The column
-- ─────────────────────────────────────────────────────────────────────────────
--
-- No index. The resolver loads the whole taxonomy in one query and walks it in
-- memory — 440 rows, every one of which it needs — so there is no filter for an
-- index to serve. A `WHERE trade_kind = 'services'` over 440 rows is a sequential
-- scan either way.

ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "trade_kind" "trade_kind";
