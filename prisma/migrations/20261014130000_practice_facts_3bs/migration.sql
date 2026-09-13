-- Board `3b-s` — the two practice facts the services listing profile adds.
--
-- `3b-s` swaps three goods fields out of the listing profile (brands, minimum
-- order, lead time) and four services fields in (sectors served, languages,
-- practice size, typical client). Two of the four already exist:
-- `sectors_served` and `languages`. Practice size exists as `team_size`, a band
-- the seller picks from a list — this adds the one part of it a band cannot
-- hold, the qualified count. Typical client is new.
--
-- The three goods fields the board takes out do not exist on `business` in
-- this tree, so nothing is dropped or hidden: the board's "out" column was
-- drawn against a goods profile that never carried them.
--
-- **Additive.** Both columns are nullable with no default, every existing row
-- keeps NULL, and a reader that has not learned them sees what it saw before,
-- so this applies before the merge.

ALTER TABLE "business"
  ADD COLUMN IF NOT EXISTS "qualified_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "typical_client" TEXT;

-- Non-negative. The upper bound against the team-size band is enforced where
-- the band is known — `checkServiceProfile` — because a CHECK cannot read a
-- number out of an enum. A CHECK passes on NULL, which is the "not stated"
-- answer and is meant to.
DO $$
BEGIN
  ALTER TABLE "business"
    ADD CONSTRAINT "business_qualified_count_non_negative" CHECK ("qualified_count" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Eighty characters, the same ceiling the form counts against. Enforced here as
-- well so no second writer — an import, a script — can store a paragraph.
DO $$
BEGIN
  ALTER TABLE "business"
    ADD CONSTRAINT "business_typical_client_length" CHECK (char_length("typical_client") <= 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
