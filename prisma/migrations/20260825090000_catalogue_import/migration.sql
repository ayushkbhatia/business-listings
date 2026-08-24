-- Handoff 3, step 2. What a CSV import needs in order to be undoable.
--
-- Criterion 7 gives a seller twenty-four hours to reverse an import. That is
-- only possible if the rows one run created can be named. Counting backwards
-- from a timestamp would also catch anything the seller typed by hand in the
-- same minute, so provenance goes on the row.
CREATE TABLE "import_run" (
  "id"            TEXT NOT NULL,
  "business_id"   TEXT NOT NULL,
  "actor_id"      UUID NOT NULL,
  "filename"      TEXT NOT NULL,
  "row_count"     INTEGER NOT NULL,
  "created_count" INTEGER NOT NULL,
  -- The mapping as applied, not as offered. A mapping overridden at the last
  -- moment must not come back different when it is reused next month.
  "column_plan"   JSONB NOT NULL,
  "reverted_at"   TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "import_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_mapping" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category_id" TEXT,
  "column_plan" JSONB NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "used_at"     TIMESTAMP(3),

  CONSTRAINT "import_mapping_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product" ADD COLUMN "import_run_id" TEXT;

ALTER TABLE "import_run"
  ADD CONSTRAINT "import_run_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, not cascade. Deleting the staff or seller account that ran an
-- import must not silently delete the record of what it did.
ALTER TABLE "import_run"
  ADD CONSTRAINT "import_run_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_mapping"
  ADD CONSTRAINT "import_mapping_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_mapping"
  ADD CONSTRAINT "import_mapping_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SET NULL, not CASCADE. Reverting a run deletes the products it created; a
-- run being deleted for any other reason must not take a live catalogue with it.
ALTER TABLE "product"
  ADD CONSTRAINT "product_import_run_id_fkey"
  FOREIGN KEY ("import_run_id") REFERENCES "import_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "import_run_business_id_created_at_idx"
  ON "import_run" ("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "import_mapping_business_id_idx"
  ON "import_mapping" ("business_id");
CREATE UNIQUE INDEX IF NOT EXISTS "import_mapping_business_id_name_key"
  ON "import_mapping" ("business_id", "name");
-- The reversal reads every row one run created.
CREATE INDEX IF NOT EXISTS "product_import_run_id_idx"
  ON "product" ("import_run_id");
