-- Invariants the service layer also enforces, written into the database so a
-- migration, a manual SQL fix or a future code path cannot quietly break them.

-- A removed review must say why. docs/data-model.md: removalReason is required
-- if removedAt is set.
ALTER TABLE "review"
  ADD CONSTRAINT "review_removal_reason_required"
  CHECK (
    "removed_at" IS NULL
    OR ("removal_reason" IS NOT NULL AND btrim("removal_reason") <> '')
  );

-- An audit reason is NOT NULL by column type; this stops a blank one.
ALTER TABLE "audit_event"
  ADD CONSTRAINT "audit_event_reason_not_blank"
  CHECK (btrim("reason") <> '');

-- Verification tier is 0..4 and staff-owned. A tier outside the ladder would
-- render as a badge nobody defined.
ALTER TABLE "business"
  ADD CONSTRAINT "business_verification_tier_range"
  CHECK ("verification_tier" BETWEEN 0 AND 4);

-- Tier 3 additionally requires a recorded site visit.
ALTER TABLE "business"
  ADD CONSTRAINT "business_tier_3_requires_visit"
  CHECK ("verification_tier" < 3 OR "visited_at" IS NOT NULL);

-- Review dimensions are 1..5 on every axis.
ALTER TABLE "review"
  ADD CONSTRAINT "review_scores_range"
  CHECK (
    "overall" BETWEEN 1 AND 5
    AND "quoted_accurate" BETWEEN 1 AND 5
    AND "on_time" BETWEEN 1 AND 5
    AND "as_described" BETWEEN 1 AND 5
    AND "responsiveness" BETWEEN 1 AND 5
  );

-- A quote line is a real line: positive quantity, non-negative price.
ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "quote_line"
  ADD CONSTRAINT "quote_line_unit_price_non_negative" CHECK ("unit_price" >= 0);

-- An enquiry reaches 1..8 businesses. The upper bound is a product decision:
-- past eight, sellers stop replying because the odds stop being worth the time.
CREATE OR REPLACE FUNCTION enquiry_recipient_limit() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM "enquiry_recipient" WHERE "enquiry_id" = NEW."enquiry_id") > 8 THEN
    RAISE EXCEPTION 'An enquiry may reach at most 8 businesses';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "enquiry_recipient_max_8"
  AFTER INSERT ON "enquiry_recipient"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enquiry_recipient_limit();

-- Full-text search over the product match surface. Handoff 1 leans on this:
-- a DN100 query must find a product the seller typed as 4".
CREATE INDEX "product_search_text_idx"
  ON "product" USING gin (to_tsvector('simple', coalesce("search_text", '')));

CREATE INDEX "business_display_name_idx"
  ON "business" USING gin (to_tsvector('simple', "display_name"));
