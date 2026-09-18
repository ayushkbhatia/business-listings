-- Board `13c` — what the report modal has to capture before `4h`'s queue works.
--
-- The export's two corrections are both about what the form fails to hold:
--
--  1. *Three reports on the same field* is not a threshold a reason radio can
--     produce. `4h` already displays the real one — `3 SEPARATE REPORTS · SAME
--     NUMBER ON 4 LISTINGS` — which is aggregation by **value**. So a report
--     carries the value it objects to, normalised (`subject_value_key`), read
--     from the listing rather than posted by the reporter, and the correction
--     the reporter offers (`suggested_value`, `suggested_category_id`).
--
--  2. The reporter is anonymous, so nobody can be told the outcome. So there is
--     an optional address (`reporter_email`), used for one message and then
--     erased (`reporter_emailed_at` records that it was), and a reference they
--     are given whether or not they leave one (`reference`).
--
-- And `B8`: `Public ×3` is corroboration only if the three are three people, so
-- the salted requester digest is stored (`reporter_key`) and one source filing
-- twice about one field collapses instead of counting twice.
--
-- ## Ordering
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- Nothing is dropped and nothing is renamed. `reference` is NOT NULL and that is
-- the one line worth reading twice: it carries a database default, so the
-- currently deployed `fileListingReport` — which knows nothing about the column
-- — keeps inserting successfully between this migration and the deploy. The
-- application generates the canonical forty-bit reference; the default is the
-- floor under anything that does not, including a row written by hand in the
-- SQL editor.
--
-- ## Two data statements, and what they are for
--
--  * `closed` reports move from `subject_field = 'address'` to `'licence'`.
--    `sweepLongExpiredLicences` has written `'licence'` since board 4h and the
--    public form wrote `'address'`, so a buyer reporting a closed unit and the
--    expiry sweep finding the same business sat in two work items. They are one
--    — which is `4h`'s own flag 4, a licence fourteen months expired found by
--    two buyers rather than by the pass.
--
--  * `subject_value_key` is backfilled for the two fields that have a value on
--    record: the telephone number and the licence number. Without it the
--    `shared_phone` detector's existing findings would not join the value group
--    the next report about that number opens.
--
-- Idempotent: applied through the Supabase MCP and then recorded, a second run
-- is a no-op.

-- ── 1 · the columns ─────────────────────────────────────────────────────────

ALTER TABLE "supplier_report"
  ADD COLUMN IF NOT EXISTS "reference"             TEXT,
  ADD COLUMN IF NOT EXISTS "subject_value_key"     TEXT,
  ADD COLUMN IF NOT EXISTS "subject_value"         TEXT,
  ADD COLUMN IF NOT EXISTS "suggested_value"       TEXT,
  ADD COLUMN IF NOT EXISTS "suggested_category_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reporter_email"        TEXT,
  ADD COLUMN IF NOT EXISTS "reporter_emailed_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reporter_key"          TEXT;

-- The floor under any writer that does not set one. Crockford's alphabet
-- without the ambiguous letters is what `lib/reports/reference.ts` emits, and
-- md5's hex digits are a subset of it, so a defaulted reference and a generated
-- one are the same shape to `isReference`.
ALTER TABLE "supplier_report"
  ALTER COLUMN "reference"
  SET DEFAULT ('RP-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)));

-- ── 2 · the rows already there ──────────────────────────────────────────────

UPDATE "supplier_report"
   SET "reference" = 'RP-' || upper(substr(md5(gen_random_uuid()::text), 1, 8))
 WHERE "reference" IS NULL;

-- A closed unit is a claim about the licence record, and that is the group the
-- expiry sweep has always filed into.
UPDATE "supplier_report"
   SET "subject_field" = 'licence'
 WHERE "kind" = 'closed' AND "subject_field" = 'address';

-- The telephone number, as `PHONE_KEY_SQL` in lib/reports/detectors.ts reads it:
-- the national significant number — digits, less `00`, `971` and the trunk
-- zero. One location per business, published first, so the join cannot
-- multiply.
UPDATE "supplier_report" r
   SET "subject_value_key" = regexp_replace(regexp_replace(l."phone", '[^0-9]', '', 'g'), '^(00)?(971)?0?', ''),
       "subject_value"     = l."phone"
  FROM (
    SELECT DISTINCT ON (x."business_id") x."business_id", x."phone"
      FROM "location" x
     WHERE x."phone" IS NOT NULL
       AND length(regexp_replace(regexp_replace(x."phone", '[^0-9]', '', 'g'), '^(00)?(971)?0?', '')) >= 8
     ORDER BY x."business_id", x."published" DESC, x."id"
  ) l
 WHERE r."subject_business_id" = l."business_id"
   AND r."subject_field" = 'phone'
   AND r."subject_value_key" IS NULL;

UPDATE "supplier_report" r
   SET "subject_value_key" = upper(regexp_replace(b."licence_number", '[^A-Za-z0-9]', '', 'g')),
       "subject_value"     = b."licence_number"
  FROM "business" b
 WHERE b."id" = r."subject_business_id"
   AND r."subject_field" = 'licence'
   AND r."subject_value_key" IS NULL;

-- ── 3 · the reference is required, and unique ───────────────────────────────

ALTER TABLE "supplier_report" ALTER COLUMN "reference" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "supplier_report_reference_key"
  ON "supplier_report" ("reference");

-- ── 4 · the constraints ─────────────────────────────────────────────────────

DO $$
BEGIN
  -- The reference is the shape the module emits, whoever wrote the row.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_reference_shape') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_reference_shape"
      CHECK ("reference" ~ '^RP-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$');
  END IF;

  -- A suggested trade belongs to the report that is about the trade. Anywhere
  -- else it is a column filled in by accident, and a moderator reading a
  -- candidate category under a complaint about a photograph would be reading a
  -- mistake as evidence.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_suggested_category_is_trade') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_suggested_category_is_trade"
      CHECK ("suggested_category_id" IS NULL OR "kind" = 'wrong_trade');
  END IF;

  -- A replacement value, not an argument. The application caps it at the same
  -- number; this is the floor under anything that does not go through it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_suggested_value_short') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_suggested_value_short"
      CHECK ("suggested_value" IS NULL OR char_length("suggested_value") BETWEEN 1 AND 160);
  END IF;

  -- Something that could be an address. Not a validator — nothing is, and a
  -- regular expression that rejects a real mailbox is worse than one that
  -- accepts a fake one — but a column that has to hold an address should not
  -- hold a sentence.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_reporter_email_shape') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_reporter_email_shape"
      CHECK (
        "reporter_email" IS NULL
        OR ("reporter_email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
            AND char_length("reporter_email") <= 254)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_report_suggested_category_id_fkey') THEN
    ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_suggested_category_id_fkey"
      FOREIGN KEY ("suggested_category_id") REFERENCES "category"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 5 · the two reads this board adds ───────────────────────────────────────

-- `SAME NUMBER ON 4 LISTINGS`: open reports of one kind about one normalised
-- value, across every listing carrying it.
CREATE INDEX IF NOT EXISTS "supplier_report_value_group_idx"
  ON "supplier_report" ("kind", "subject_field", "subject_value_key", "outcome");

-- Has this source already said this about this listing? `B8` — one source is
-- one signal, not three.
CREATE INDEX IF NOT EXISTS "supplier_report_reporter_key_idx"
  ON "supplier_report" ("reporter_key", "subject_business_id", "kind", "subject_field");
