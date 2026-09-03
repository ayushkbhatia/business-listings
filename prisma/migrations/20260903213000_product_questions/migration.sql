-- Board 1g: a buyer's question about one product, and the seller's answer.

-- CreateTable
CREATE TABLE "product_question" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "asker_id" UUID,
    "body" TEXT NOT NULL,
    "answer" TEXT,
    "answered_at" TIMESTAMP(3),
    "answered_by" UUID,
    "removed_at" TIMESTAMP(3),
    "removal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_question_pkey" PRIMARY KEY ("id")
);

-- The public read: answered, not removed, for one product.
CREATE INDEX "product_question_product_id_removed_at_answered_at_idx"
  ON "product_question"("product_id", "removed_at", "answered_at");

-- The seller's queue: unanswered first, for one business.
CREATE INDEX "product_question_business_id_answered_at_idx"
  ON "product_question"("business_id", "answered_at");

-- AddForeignKey
ALTER TABLE "product_question" ADD CONSTRAINT "product_question_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_question" ADD CONSTRAINT "product_question_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_question" ADD CONSTRAINT "product_question_asker_id_fkey"
  FOREIGN KEY ("asker_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An answer is a text and a timestamp together, or neither.
--
-- The public card reads `answered_at IS NOT NULL` to decide what to show and
-- renders `answer` verbatim. A row with one and not the other renders either a
-- blank answer under a question or a dated answer with nothing in it, and both
-- read as a broken page rather than as missing data.
--
-- A removal is the same pairing for the same reason `review` requires it: the
-- reason is what an audit row and an appeal are built on.
--
-- Idempotent, because `migrate dev` regenerates this table when it diffs the
-- schema and would drop a constraint it does not know about.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_question_answer_complete'
  ) THEN
    ALTER TABLE "product_question" ADD CONSTRAINT "product_question_answer_complete" CHECK (
      ("answer" IS NULL AND "answered_at" IS NULL)
      OR (
        "answer" IS NOT NULL
        AND "answered_at" IS NOT NULL
        AND length(btrim("answer")) > 0
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_question_removal_reasoned'
  ) THEN
    ALTER TABLE "product_question" ADD CONSTRAINT "product_question_removal_reasoned" CHECK (
      ("removed_at" IS NULL AND "removal_reason" IS NULL)
      OR (
        "removed_at" IS NOT NULL
        AND "removal_reason" IS NOT NULL
        AND length(btrim("removal_reason")) > 0
      )
    );
  END IF;

  -- A question with nothing in it is not a question.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_question_body_present'
  ) THEN
    ALTER TABLE "product_question" ADD CONSTRAINT "product_question_body_present" CHECK (
      length(btrim("body")) > 1
    );
  END IF;
END $$;
