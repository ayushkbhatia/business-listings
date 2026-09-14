-- Board `3j-s` — reply to a brief with a proposal, and a supplier's own decline.
--
-- A proposal is a quote: the same `quote` row, reference, revision, window,
-- fence and acceptance, with a `quote_proposal` row beside it in place of lines.
-- One fee on a stated basis, a scope and an exclusions list — no quantity, no
-- unit price, no line.
--
-- And `enquiry_recipient.state = 'declined'` gains the writer the buyer's
-- tracking page was already waiting for: the supplier, with their own reason.
--
-- **Additive, and ordered to apply ahead of the code** (`docs/deployments.md`
-- § Ordering): one new table nothing deployed reads, three nullable columns with
-- no default, and two triggers that refuse only what nothing deployed can write —
-- a line on a quote that has a proposal, and an edit to a proposal that has been
-- sent. Production holds no brief, no service line and no quote on either when
-- this is written.
--
-- Idempotent throughout, because a migration applied through the Supabase MCP and
-- then recorded is the path production takes, and a second run must be a no-op.

-- ── 1 · The proposal ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "quote_proposal" (
    "quote_id" TEXT NOT NULL,
    "service_id" TEXT,
    "service_name" TEXT NOT NULL,
    "fee_basis" TEXT,
    "fee_basis_label" TEXT,
    "fee_aed" DECIMAL(12,2),
    "mobilisation_aed" DECIMAL(12,2),
    "term_months" INTEGER,
    "scope" TEXT NOT NULL DEFAULT '',
    "deliverable" TEXT,
    "delivered_where" TEXT,
    "exclusions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_proposal_pkey" PRIMARY KEY ("quote_id")
);

CREATE INDEX IF NOT EXISTS "quote_proposal_service_id_idx" ON "quote_proposal"("service_id");

-- PostgREST lockdown: RLS on with no policies, like every application table. The
-- event trigger would do it; this row carries a price, so it is said here too.
ALTER TABLE "quote_proposal" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  ALTER TABLE "quote_proposal"
    ADD CONSTRAINT "quote_proposal_quote_id_fkey"
    FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `SET NULL`: a deleted service must not take the record of what was proposed
-- with it. The copied name and basis are what the buyer read.
DO $$
BEGIN
  ALTER TABLE "quote_proposal"
    ADD CONSTRAINT "quote_proposal_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The shape of the numbers. The same floors `sendProposal` refuses on, held here
-- so the next writer cannot forget them: a fee and a mobilisation are never
-- negative, a term is between one month and ten years, and a basis key never
-- travels without the words the buyer reads for it.
DO $$
BEGIN
  ALTER TABLE "quote_proposal"
    ADD CONSTRAINT "quote_proposal_amounts_nonnegative"
    CHECK (("fee_aed" IS NULL OR "fee_aed" >= 0) AND ("mobilisation_aed" IS NULL OR "mobilisation_aed" >= 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "quote_proposal"
    ADD CONSTRAINT "quote_proposal_term_range"
    CHECK ("term_months" IS NULL OR "term_months" BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "quote_proposal"
    ADD CONSTRAINT "quote_proposal_basis_with_label"
    CHECK (("fee_basis" IS NULL) = ("fee_basis_label" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2 · A proposal has no lines (B2, acceptance criterion 1) ────────────────
--
-- A trigger rather than a form rule. `sendQuoteForBusiness` and `saveDraft` both
-- refuse an enquiry for work, but a line written by any later path — an import,
-- a script, a composer that forgot — would put a parts list back on a proposal,
-- which is the one thing the board says must not exist.

CREATE OR REPLACE FUNCTION "quote_line_not_on_proposal"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "quote_proposal" WHERE "quote_id" = NEW."quote_id") THEN
    RAISE EXCEPTION 'quote % is a proposal and carries no lines', NEW."quote_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "quote_line_not_on_proposal" ON "quote_line";
CREATE TRIGGER "quote_line_not_on_proposal"
  BEFORE INSERT OR UPDATE OF "quote_id" ON "quote_line"
  FOR EACH ROW EXECUTE FUNCTION "quote_line_not_on_proposal"();

-- ── 3 · A sent proposal is immutable (B10, acceptance criterion 7) ──────────
--
-- A revision is a new quote with a new proposal row. The one update allowed is
-- to a row whose quote is still a draft — which includes the send itself, since
-- it writes the proposal before it promotes the quote in the same transaction.
-- Deletes are not guarded: a draft is discarded, and a deleted enquiry cascades.

CREATE OR REPLACE FUNCTION "quote_proposal_immutable"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "quote" WHERE "id" = OLD."quote_id" AND "status" <> 'draft'
  ) THEN
    RAISE EXCEPTION 'proposal % has been sent; send a revision instead', OLD."quote_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "quote_proposal_immutable" ON "quote_proposal";
CREATE TRIGGER "quote_proposal_immutable"
  BEFORE UPDATE ON "quote_proposal"
  FOR EACH ROW EXECUTE FUNCTION "quote_proposal_immutable"();

-- Neither function does anything useful called directly, and neither is the
-- browser's to call — the same hardening `enquiry_recipient_limit` carries.
REVOKE ALL ON FUNCTION public.quote_line_not_on_proposal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_proposal_immutable() FROM PUBLIC, anon, authenticated;

-- ── 4 · A supplier's own decline ────────────────────────────────────────────
--
-- Null on every existing declined row, and correctly: until now the only writer
-- of `declined` was the buyer accepting another supplier.

ALTER TABLE "enquiry_recipient"
  ADD COLUMN IF NOT EXISTS "declined_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "declined_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "decline_reason" TEXT;

DO $$
BEGIN
  ALTER TABLE "enquiry_recipient"
    ADD CONSTRAINT "enquiry_recipient_declined_by_id_fkey"
    FOREIGN KEY ("declined_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A decline is a state, and the timestamp and the state agree: a row cannot be
-- declined by its supplier and still open. The reason is short because the
-- buyer's row prints it on one line.
DO $$
BEGIN
  ALTER TABLE "enquiry_recipient"
    ADD CONSTRAINT "enquiry_recipient_decline_shape"
    CHECK (
      ("declined_at" IS NULL OR "state" = 'declined')
      AND ("decline_reason" IS NULL OR ("declined_at" IS NOT NULL AND char_length("decline_reason") BETWEEN 1 AND 200))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
