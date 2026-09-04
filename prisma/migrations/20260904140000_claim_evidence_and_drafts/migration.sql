-- Board 2b: who is claiming, what the document said, and a draft so
-- "Save & exit" is real.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "claimant_role" AS ENUM ('owner', 'partner', 'manager', 'pro', 'authorised_signatory');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
--
-- The claimant's own details, and the two pairs that let a reviewer see a
-- correction. `stated_*` is what was submitted; `ocr_*` is what was read off
-- the document before anybody touched it. Neither is written onto `business`:
-- the register's own numbers are the record a claim is measured against, and a
-- claim editing its own evidence is not evidence.
ALTER TABLE "claim_submission" ADD COLUMN IF NOT EXISTS "claimant_name" TEXT;
ALTER TABLE "claim_submission" ADD COLUMN IF NOT EXISTS "claimant_role" "claimant_role";
ALTER TABLE "claim_submission" ADD COLUMN IF NOT EXISTS "stated_licence_number" TEXT;
ALTER TABLE "claim_submission" ADD COLUMN IF NOT EXISTS "stated_licence_expiry" TIMESTAMP(3);
ALTER TABLE "claim_submission" ADD COLUMN IF NOT EXISTS "ocr_licence_number" TEXT;
ALTER TABLE "claim_submission" ADD COLUMN IF NOT EXISTS "ocr_licence_expiry" TIMESTAMP(3);
ALTER TABLE "claim_submission" ADD COLUMN IF NOT EXISTS "ocr_confidence" DOUBLE PRECISION;

-- A confidence outside 0..1 is a bug in an extractor, not a value to store and
-- render. Refused here so the one place it could enter is the place it is
-- caught.
DO $$ BEGIN
  ALTER TABLE "claim_submission"
    ADD CONSTRAINT "claim_submission_ocr_confidence_range"
    CHECK ("ocr_confidence" IS NULL OR ("ocr_confidence" >= 0 AND "ocr_confidence" <= 1));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "onboarding_draft" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "business_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_draft_user_id_business_id_step_key"
  ON "onboarding_draft"("user_id", "business_id", "step");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "onboarding_draft_updated_at_idx" ON "onboarding_draft"("updated_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "onboarding_draft" ADD CONSTRAINT "onboarding_draft_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "onboarding_draft" ADD CONSTRAINT "onboarding_draft_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
