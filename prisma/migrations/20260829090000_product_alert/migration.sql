-- Handoff 5, step 6. Criterion 8 — the zero-result alert.
--
--   "A zero-result alert fires when a matching product is later listed."
--
-- The end of the flywheel the README describes. A buyer searches for something
-- nobody stocks; `ZeroResultQuery` records the gap and feeds the recruitment
-- call list; the CRM finds a supplier; the supplier lists the part; and this is
-- what turns that back into an enquiry rather than a statistic.

CREATE TABLE "product_alert" (
  "id"                    TEXT NOT NULL,
  "query"                 TEXT NOT NULL,
  "category_id"           TEXT,
  "emirate"               "emirate",
  "user_id"               UUID NOT NULL,
  "zero_result_query_id"  TEXT,
  "notified_at"           TIMESTAMP(3),
  "matched_product_id"    TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_alert_pkey" PRIMARY KEY ("id")
);

-- A query somebody is waiting on has words in it. An empty alert would match
-- the first product anybody lists.
ALTER TABLE "product_alert"
  ADD CONSTRAINT "product_alert_has_query"
  CHECK (length(btrim("query")) >= 2);

-- It fired, or it did not. A row that names a product without a time — or a
-- time without a product — is a half-written notification nobody can audit.
ALTER TABLE "product_alert"
  ADD CONSTRAINT "product_alert_fired_together"
  CHECK (("notified_at" IS NULL) = ("matched_product_id" IS NULL));

CREATE INDEX "product_alert_notified_at_idx" ON "product_alert"("notified_at");

ALTER TABLE "product_alert"
  ADD CONSTRAINT "product_alert_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_alert"
  ADD CONSTRAINT "product_alert_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_alert"
  ADD CONSTRAINT "product_alert_matched_product_id_fkey"
  FOREIGN KEY ("matched_product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

