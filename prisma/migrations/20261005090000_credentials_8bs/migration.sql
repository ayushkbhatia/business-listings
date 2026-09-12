-- Board `8b-s` — credentials, where photographs were.
--
-- Additive: two enums and one table. Nothing is dropped and no existing row
-- changes. It applies **before** the deploy that reads it —
-- `docs/deployments.md` § Ordering — and the code that ships with it treats an
-- empty `credential` table as the normal state, because it is: every one of the
-- 123 live businesses has none, and the screen that writes them says four times
-- that nothing on it is required.
--
-- Idempotent throughout, for the reasons the last four migrations give.

-- ── 1 · What a firm is licensed, approved or insured to do ────────────────
--
-- `trade_licence` is deliberately not a kind. It is on `business` already —
-- number, authority, expiry and `verified_at` — and it is the one thing the
-- platform has actually checked. A credential row mirroring it would be a
-- second source of truth for the only verified fact on the listing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_kind') THEN
    CREATE TYPE "credential_kind" AS ENUM (
      'fta_tax_agent',
      'mof_audit_approval',
      'professional_body',
      'indemnity_insurance',
      'other'
    );
  END IF;

  -- Two tiers, not the board's three. *Register-verified* and *verifiable on
  -- submission* are the same statement — the platform checked this against a
  -- register — differing only in when, which is not a durable fact about a row.
  -- The third label still renders: `WE VERIFY THIS` is a promise about the
  -- field before it is submitted. A value nothing could write is a tier some
  -- screen would eventually put a badge on.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trust_tier') THEN
    CREATE TYPE "trust_tier" AS ENUM ('register_verified', 'seller_claim');
  END IF;
END
$$;

-- ── 2 · The claim, and the file it may or may not have ────────────────────
--
-- Every column but the kind is nullable, and that is the board rather than
-- laziness: **nothing on this screen is required**. A credential may be a
-- number with no file or a file with no number, and `expires_on` stays nullable
-- for good — making it required is the change that turns the screen back into a
-- compliance form.
CREATE TABLE IF NOT EXISTS "credential" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "kind"        "credential_kind" NOT NULL,
  "identifier"  TEXT,
  "issuer"      TEXT,
  "expires_on"  TIMESTAMP(3),
  "document_id" TEXT,
  "trust"       "trust_tier" NOT NULL DEFAULT 'seller_claim',
  "verified_on" TIMESTAMP(3),
  "verified_by" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "credential_business_id_trust_idx" ON "credential" ("business_id", "trust");
-- For the suggestion rate: how many verified suppliers in a subcategory hold
-- this kind. Read per kind across businesses, which is the other direction.
CREATE INDEX IF NOT EXISTS "credential_kind_trust_idx" ON "credential" ("kind", "trust");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_business_id_fkey') THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- SET NULL, not CASCADE. A credential is the claim and the document is the
  -- file; deleting the file should leave the claim standing as what it then is,
  -- which is the seller's word for it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_document_id_fkey') THEN
    ALTER TABLE "credential" ADD CONSTRAINT "credential_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "document"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- A tier the platform did not set has no business carrying a check date or a
  -- register's name, and a register-verified row without them is a badge with
  -- nothing behind it. Prisma cannot express either direction.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_verified_has_a_register') THEN
    ALTER TABLE "credential"
      ADD CONSTRAINT "credential_verified_has_a_register"
      CHECK (
        ("trust" = 'seller_claim' AND "verified_on" IS NULL AND "verified_by" IS NULL)
        OR ("trust" = 'register_verified' AND "verified_on" IS NOT NULL AND "verified_by" IS NOT NULL)
      );
  END IF;
END
$$;
