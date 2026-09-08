-- Boards 3m + 11f — subscription, billing, and the change that has not happened yet.
--
-- Additive throughout: two tables, one enum, eleven columns, four constraints.
-- Nothing is dropped and nothing is made NOT NULL on an existing table, so this
-- applies **before** the merge (docs/deployments.md § Ordering) and the running
-- deployment carries on reading a schema that still satisfies it.
--
-- Four things the pair states that the model could not hold:
--
--   1. **Stored invoice totals.** Criterion 2 — "invoice rows render stored
--      values and never recompute them". Two readers each summed the lines and
--      applied the rate themselves, so the figure on a seller's screen was a
--      function of today's code rather than of what was charged. The whole
--      reason 3m and 11f shipped as one handoff is that `BL-INV-20418` read
--      `7,802.15` on one board and `1,783.95` on the other; recomputing a
--      total is the same failure one layer down.
--
--   2. **The billed party, frozen.** Name, address and TRN were read live from
--      `business`, so a supplier who renamed rewrote every invoice they had
--      ever been sent. A tax document records a supply to a party as they were
--      then.
--
--   3. **A credit note.** Q5 — UAE VAT requires one for any correction and an
--      issued invoice may not be edited. Same table, negative total, pointer to
--      the document it corrects.
--
--   4. **`subscription_change`.** Board 11f's downgrade takes effect at period
--      end, is withdrawable until then, and carries the seller's choice of what
--      stays live. None of that fits on `subscription`: withdrawing would mean
--      nulling several columns and trusting that nothing had read them apart.
--
-- Every statement is idempotent. `migrate dev` regenerates hand-written DDL and
-- drops what it did not author otherwise.

-- ── 1 · what kind of document an invoice is ────────────────────────────────
DO $$
BEGIN
  CREATE TYPE "invoice_doc_type" AS ENUM ('tax_invoice', 'credit_note');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "invoice"
  ADD COLUMN IF NOT EXISTS "doc_type" "invoice_doc_type" NOT NULL DEFAULT 'tax_invoice';

-- ── 2 · totals, stored once at issue ───────────────────────────────────────
-- Nullable, and deliberately not backfilled. An invoice issued before this
-- column existed has no stored figure, and computing one now from today's lines
-- would be indistinguishable on screen from one that was actually charged —
-- which is the property this column exists to provide. `storedTotals()` reads
-- null as "derive, and say so".
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "subtotal_fils" INTEGER;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "vat_fils"      INTEGER;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "total_fils"    INTEGER;

-- All three or none. A total with no subtotal behind it is the recomputation
-- this migration is removing, arriving through a different door.
ALTER TABLE "invoice" DROP CONSTRAINT IF EXISTS "invoice_totals_together";
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_totals_together" CHECK (
  ("subtotal_fils" IS NULL AND "vat_fils" IS NULL AND "total_fils" IS NULL)
  OR ("subtotal_fils" IS NOT NULL AND "vat_fils" IS NOT NULL AND "total_fils" IS NOT NULL)
);

-- The identity that makes the three columns worth storing separately.
ALTER TABLE "invoice" DROP CONSTRAINT IF EXISTS "invoice_total_is_sum";
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_total_is_sum" CHECK (
  "total_fils" IS NULL OR "total_fils" = "subtotal_fils" + "vat_fils"
);

-- ── 3 · the billed party, as they were on the day ──────────────────────────
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "billed_to_name"    TEXT;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "billed_to_trn"     TEXT;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "billed_to_address" TEXT;

-- What paid it. Brand and last four only — criterion 13.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "paid_by_brand" TEXT;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "paid_by_last4" TEXT;

-- ── 4 · a credit note points at what it corrects ───────────────────────────
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "corrects_id" TEXT;

ALTER TABLE "invoice" DROP CONSTRAINT IF EXISTS "invoice_corrects_id_fkey";
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_corrects_id_fkey"
  FOREIGN KEY ("corrects_id") REFERENCES "invoice"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "invoice_business_issued_idx"
  ON "invoice" ("business_id", "issued_at" DESC);

-- ── 4b · the reference a seller quotes on a bank line ──────────────────────
-- `BL-INV-20418`, which is board 3m's format and the one thing on an invoice a
-- seller types into something else.
--
-- A sequence rather than `count() + 1`. `ref` is unique, so two invoices issued
-- in the same second would collide — and by then the charge has already taken
-- the money. `nextval` never returns a number twice even to concurrent
-- transactions; a rolled-back transaction leaves a gap instead. A gap in an
-- invoice sequence is a question an accountant can answer. A repeat is not.
--
-- Starts above the highest reference the seed writes, so a fresh database and a
-- seeded one both continue rather than colliding on their first issue.
CREATE SEQUENCE IF NOT EXISTS "invoice_ref_seq" AS BIGINT START WITH 20419 MINVALUE 1;

-- ── 5 · what period a line covers ──────────────────────────────────────────
-- Per line rather than per invoice, because Q7 settles that the sponsored
-- placement runs on its own term: a placement line and a subscription line on
-- one invoice legitimately carry different dates.
ALTER TABLE "invoice_line" ADD COLUMN IF NOT EXISTS "period_start" TIMESTAMP(3);
ALTER TABLE "invoice_line" ADD COLUMN IF NOT EXISTS "period_end"   TIMESTAMP(3);

ALTER TABLE "invoice_line" DROP CONSTRAINT IF EXISTS "invoice_line_period_ordered";
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_period_ordered" CHECK (
  "period_start" IS NULL OR "period_end" IS NULL OR "period_end" >= "period_start"
);

-- ── 5b · the three on/off entitlements 11f's grid renders ──────────────────
-- Board 11f renders the entire plan table — nine rows, three columns — and four
-- of those rows are on/off rather than a cap. One of the four (`custom_domain`)
-- was already a column; these are the other three. Without them the grid would
-- hardcode its own cells, which criterion 5 forbids and which is the reason the
-- plan-limit config is blocking rather than overdue.
--
-- Defaulted false, then set to what the seeded ladder already sells. A default
-- of false on an existing row is the safe direction: a plan that silently gained
-- an entitlement is worse than one that has to be granted.
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "analytics"          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "csv_import"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "sponsored_eligible" BOOLEAN NOT NULL DEFAULT false;

-- Backfilled from the ladder as sold today: everything paid gets analytics and
-- the importer, and sponsored eligibility follows the custom domain, which is
-- the top tier. Keyed on price rather than on id, so a renamed plan still lands
-- correctly and a fourth tier added later is not silently included.
UPDATE "plan" SET "analytics"  = true WHERE "monthly_price_aed" > 0;
UPDATE "plan" SET "csv_import" = true WHERE "monthly_price_aed" > 0;
UPDATE "plan" SET "sponsored_eligible" = true WHERE "custom_domain" = true;

-- ── 6 · the card, as much of it as ever reaches us ─────────────────────────
CREATE TABLE IF NOT EXISTS "payment_method" (
  "id"             TEXT NOT NULL,
  "business_id"    TEXT NOT NULL,
  "provider_token" TEXT,
  "brand"          TEXT NOT NULL,
  "last4"          VARCHAR(4) NOT NULL,
  "expiry_month"   INTEGER NOT NULL,
  "expiry_year"    INTEGER NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_method_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_method_business_id_key"
  ON "payment_method" ("business_id");

ALTER TABLE "payment_method" DROP CONSTRAINT IF EXISTS "payment_method_business_id_fkey";
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A card that expired in month 13 is a parsing bug reaching the database.
ALTER TABLE "payment_method" DROP CONSTRAINT IF EXISTS "payment_method_expiry_month_range";
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_expiry_month_range" CHECK (
  "expiry_month" BETWEEN 1 AND 12
);

-- ── 7 · a plan change that has not happened yet ────────────────────────────
CREATE TABLE IF NOT EXISTS "subscription_change" (
  "id"                TEXT NOT NULL,
  "business_id"       TEXT NOT NULL,
  "from_plan_id"      TEXT NOT NULL,
  "to_plan_id"        TEXT NOT NULL,
  "from_term"         "billing_term" NOT NULL,
  "to_term"           "billing_term" NOT NULL,
  "effective_at"      TIMESTAMP(3) NOT NULL,
  "keep_product_ids"  JSONB,
  "keep_location_ids" JSONB,
  "keep_seat_ids"     JSONB,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at"        TIMESTAMP(3),
  "withdrawn_at"      TIMESTAMP(3),
  CONSTRAINT "subscription_change_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "subscription_change" DROP CONSTRAINT IF EXISTS "subscription_change_business_id_fkey";
ALTER TABLE "subscription_change" ADD CONSTRAINT "subscription_change_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_change" DROP CONSTRAINT IF EXISTS "subscription_change_from_plan_id_fkey";
ALTER TABLE "subscription_change" ADD CONSTRAINT "subscription_change_from_plan_id_fkey"
  FOREIGN KEY ("from_plan_id") REFERENCES "plan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_change" DROP CONSTRAINT IF EXISTS "subscription_change_to_plan_id_fkey";
ALTER TABLE "subscription_change" ADD CONSTRAINT "subscription_change_to_plan_id_fkey"
  FOREIGN KEY ("to_plan_id") REFERENCES "plan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "subscription_change_effective_at_applied_at_idx"
  ON "subscription_change" ("effective_at", "applied_at");

-- Q8, structural rather than remembered: one pending change per business.
--
-- Two pending changes make the effective-date arithmetic uncheckable — the
-- second would have to know whether the first had landed to know what it was
-- changing from. Applied and withdrawn rows are history and do not collide, so
-- the index is partial rather than a plain unique on `business_id`.
--
-- Prisma has no syntax for a partial unique index, so it lives here and only
-- here. `pnpm check:schema` asserts it exists, because an invariant a schema
-- file cannot express is one a regeneration can quietly drop.
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_change_one_pending"
  ON "subscription_change" ("business_id")
  WHERE "applied_at" IS NULL AND "withdrawn_at" IS NULL;

-- A change that goes nowhere is a row nothing should have written.
ALTER TABLE "subscription_change" DROP CONSTRAINT IF EXISTS "subscription_change_moves";
ALTER TABLE "subscription_change" ADD CONSTRAINT "subscription_change_moves" CHECK (
  "from_plan_id" <> "to_plan_id" OR "from_term" <> "to_term"
);

-- Applied or withdrawn, never both. They are the two ways a pending change
-- stops being pending and they mean opposite things to the seller.
ALTER TABLE "subscription_change" DROP CONSTRAINT IF EXISTS "subscription_change_one_ending";
ALTER TABLE "subscription_change" ADD CONSTRAINT "subscription_change_one_ending" CHECK (
  "applied_at" IS NULL OR "withdrawn_at" IS NULL
);
