-- Board `1d-s` — the storefront with the catalogue taken out of it.
--
-- Additive: one table and two nullable columns. Nothing is dropped, nothing is
-- re-typed and no existing row changes. It applies **before** the deploy that
-- reads it — `docs/deployments.md` § Ordering — and the code that ships with it
-- treats every one of these as empty on every existing row, because they are.
--
-- Idempotent throughout, for the reasons the last five migrations give.

-- ── 1 · Sector counts, declared by the firm ───────────────────────────────
--
-- B8: *counts are engagements the firm has declared, not audited by us.* A
-- table rather than a second array beside `business.sectors_served`, because
-- two arrays that must stay index-aligned are one bug away from printing one
-- sector's count under another. Keyed by the sector's matching form.
CREATE TABLE IF NOT EXISTS "sector_engagement" (
  "business_id" TEXT NOT NULL,
  "sector_slug" TEXT NOT NULL,
  "engagements" INTEGER NOT NULL,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sector_engagement_pkey" PRIMARY KEY ("business_id", "sector_slug")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sector_engagement_business_id_fkey') THEN
    ALTER TABLE "sector_engagement" ADD CONSTRAINT "sector_engagement_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "business"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Zero is not a declaration worth printing, and a six-figure count of
  -- engagements in one sector is a typo rather than a practice. The form says
  -- both; this is where the rule lives so no other writer can forget it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sector_engagement_engagements_range') THEN
    ALTER TABLE "sector_engagement" ADD CONSTRAINT "sector_engagement_engagements_range"
      CHECK ("engagements" BETWEEN 1 AND 99999);
  END IF;

  -- The matching form, never the label: trimmed, collapsed and case-folded, so
  -- *Free Zone* and *free zone* cannot hold two counts for one sector.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sector_engagement_slug_folded') THEN
    ALTER TABLE "sector_engagement" ADD CONSTRAINT "sector_engagement_slug_folded"
      CHECK ("sector_slug" = lower("sector_slug") AND length("sector_slug") BETWEEN 1 AND 40);
  END IF;
END
$$;

-- ── 2 · The service an enquiry line asks about ────────────────────────────
--
-- B11, and `docs/services-spec.md` S1: the enquiry carries the service in as
-- its subject the way a product page carries a product. SET NULL, not CASCADE:
-- deleting a service must not delete the record of what a buyer asked, and the
-- line's description keeps the name as it was sent.
ALTER TABLE "enquiry_line" ADD COLUMN IF NOT EXISTS "service_id" TEXT;

CREATE INDEX IF NOT EXISTS "enquiry_line_service_idx" ON "enquiry_line" ("service_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiry_line_service_id_fkey') THEN
    ALTER TABLE "enquiry_line" ADD CONSTRAINT "enquiry_line_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "service"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── 3 · How big the job is, in the buyer's words ──────────────────────────
--
-- Decision D7, 9 Sep 2026: one free-text scale field, not a controlled set per
-- subcategory. Null on every goods enquiry, where the lines carry the size.
ALTER TABLE "enquiry" ADD COLUMN IF NOT EXISTS "scale" TEXT;
