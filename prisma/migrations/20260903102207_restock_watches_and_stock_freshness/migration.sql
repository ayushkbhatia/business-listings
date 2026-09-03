-- Board 1e: restock watches, and a stock number that knows how old it is.

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "stock_updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "product_alert" ADD COLUMN     "product_id" TEXT;

-- CreateIndex
CREATE INDEX "product_alert_product_id_notified_at_idx" ON "product_alert"("product_id", "notified_at");

-- AddForeignKey
ALTER TABLE "product_alert" ADD CONSTRAINT "product_alert_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing stock numbers are dated to the row's last change.
--
-- The honest reading of what we have: nothing recorded when a count was stated,
-- and `updated_at` is the closest thing to it. For seeded and imported rows the
-- two are the same moment. Rows with no count stay null, which reads as stale
-- and shows a band rather than a number — the safe direction.
UPDATE "product" SET "stock_updated_at" = "updated_at" WHERE "stock_qty" IS NOT NULL;

-- The old constraint required a query of two characters or more, which a
-- restock watch does not have and should not fake.
--
-- Putting the product's name in `query` would satisfy it and would be a lie:
-- that column means "the words the buyer typed", and the gap report counts it
-- as demand expressed through search. A watch on an out-of-stock line is not a
-- search anybody made.
ALTER TABLE "product_alert" DROP CONSTRAINT IF EXISTS "product_alert_has_query";

-- An alert has to be about something.
--
-- A row with neither a query nor a product is a notification with no subject:
-- the sweep would never match it and it would sit open forever, counted in
-- every "people are waiting for this" figure while meaning nothing. Enforced
-- here because the alert service is not the only writer, and written
-- idempotently so `migrate dev` cannot regenerate the table without it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_alert_watches_something'
  ) THEN
    ALTER TABLE "product_alert"
      ADD CONSTRAINT "product_alert_watches_something"
      CHECK ("product_id" IS NOT NULL OR length(btrim("query")) > 0);
  END IF;
END
$$;
