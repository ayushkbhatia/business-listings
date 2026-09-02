-- Certificates on the public storefront: the row, never the file.
--
-- Board 1d asks for a certificates block listing "name and validity month
-- only, never the document". These three columns are that row. `storage_path`
-- is untouched and stays behind the signed-URL route, because a trade licence
-- scan carries the licence number and a signature, and an ISO certificate
-- carries the auditor's reference. "Holds ISO 9001 until March 2027" helps a
-- buyer; the scan hands over a forgeable original.

-- AlterTable
ALTER TABLE "document" ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "valid_until" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "document_business_id_is_public_idx" ON "document"("business_id", "is_public");

-- A public document has to have a name somebody can read.
--
-- Enforced here rather than in the render for the same reason every other
-- invariant in this schema is: the storefront is not the only writer, and a
-- row published with `display_name` null would fall back to `filename` —
-- putting "scan_0043_final.pdf" on a supplier's shop window, or worse, a
-- filename containing their licence number.
--
-- Idempotent because a hand-written constraint that `migrate dev` regenerates
-- without is a constraint that silently disappears on the next migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_public_has_a_name'
  ) THEN
    ALTER TABLE "document"
      ADD CONSTRAINT "document_public_has_a_name"
      CHECK (NOT "is_public" OR "display_name" IS NOT NULL);
  END IF;
END
$$;
