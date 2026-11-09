-- Task T4.4 — the two expression indexes the dedupe candidate query needs.
--
-- Purely **additive**: two indexes, no column, no constraint, no data. By
-- `docs/deployments.md` § Ordering that means it applies *before* the merge
-- that reads it, and nothing on `main` reads it until then.
--
-- Hand-written and idempotent, which is this project's rule for an index:
-- `prisma migrate dev` drops anything it did not generate from the schema, so
-- an index expressed only here has to survive being regenerated.
--
-- ## Why an expression and not a column
--
-- The matcher compares **digits**, not the string an authority wrote.
-- `licenceDigits` strips everything but the digits, and `phoneKey` does the
-- same and then takes off the country code — so `DED-441908`, `ded 441908` and
-- `441908` are one licence, and `+971 4 333 1100`, `04 333 1100` and
-- `043331100` are one phone. Matching on `licence_number` itself would miss
-- every one of those, which is what the in-process index was for.
--
-- A generated column would be the other answer and is the wrong one here:
-- `prisma migrate dev` drops a column the schema does not declare, and the
-- schema cannot declare a generated one.
--
-- ## Not CONCURRENTLY, and when that changes
--
-- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction and every
-- migration here applies inside one. Production holds a few hundred listings
-- today, so both of these build in milliseconds. **The import changes that** —
-- at 41,000 businesses and their branches these are seconds, and the next index
-- added after the import lands should be built `CONCURRENTLY` outside the
-- migration runner. The same note is on `20261118090000_search_scale_indexes`.

-- ── 1 · A licence by its digits ─────────────────────────────────────────────
--
-- `licenceDigits(listing.licenceNumber)`, exactly: every non-digit removed.
-- `coalesce` because the column is nullable and a null licence should index as
-- the empty string rather than be left out — the candidate query asks for
-- equality against keys that are never empty, so the empty rows cost one
-- entry each and never match.
CREATE INDEX IF NOT EXISTS "business_licence_digits_idx"
  ON "business" (regexp_replace(coalesce("licence_number", ''), '[^0-9]', '', 'g'));

-- ── 2 · A branch's phone by its digits ──────────────────────────────────────
--
-- The country code is **not** stripped here, deliberately: the national form
-- is a suffix of the international one, so the query asks for both spellings of
-- each key and the index answers either with an equality. Doing the stripping in
-- the index would make `00971…` and `971…` unfindable unless the expression
-- reproduced `phoneKey` exactly — three nested conditionals, in an index
-- definition, that must not drift from the TypeScript.
CREATE INDEX IF NOT EXISTS "location_phone_digits_idx"
  ON "location" (regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'));
