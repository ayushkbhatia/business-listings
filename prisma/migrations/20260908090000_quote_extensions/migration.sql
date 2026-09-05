-- Board 3k: extending a quote's window, and counting how often.
--
-- Idempotent throughout, like every hand-written migration here.
--
-- ## Why a count and not just a date
--
-- `expires_at` alone would say a quote's window moved and nothing about how many
-- times. Board 3k §11 names `times previously extended` as the number worth
-- watching, and the reason is that it points somewhere else: a quote extended
-- twice is not a 3k problem, it is a sign that board 3j's default validity
-- window is too short. A screen that can only say "extended" cannot make that
-- argument, and the argument is the point of collecting it.
--
-- It is also what §5 means by "repeat extends are allowed and counted". A quote
-- extended three times is a lost quote the seller has not marked, and that is
-- worth knowing before it is worth preventing.
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "extension_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "last_extended_at" TIMESTAMP(3);

-- Who moved it. Board 3k §5 puts "validity extended, by whom, to when" in the
-- thread as a system line, and a line naming nobody is a line a two-person
-- business cannot act on.
--
-- `SET NULL`: removing a seat must not delete the quote, and must not block the
-- removal either. The system line then reads without a name rather than
-- disappearing — what happened to the window still happened.
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "extended_by_id" UUID;

DO $$
BEGIN
    ALTER TABLE "quote" ADD CONSTRAINT "quote_extended_by_id_fkey"
        FOREIGN KEY ("extended_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An extension and its date arrive together, or neither does. Without this the
-- thread's system line can render "extended by Rajesh" with no date beside it.
DO $$
BEGIN
    ALTER TABLE "quote" ADD CONSTRAINT "quote_extension_dated"
        CHECK (("extension_count" = 0) = ("last_extended_at" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The pipeline's two live tabs read this: awaiting is `expires_at` in the
-- future, expiring soon is the next seven days of it, and both are scoped to one
-- business. Partial, because a quote with no window — a draft — is never on
-- either.
CREATE INDEX IF NOT EXISTS "quote_window_idx"
  ON "quote"("business_id", "expires_at")
  WHERE "expires_at" IS NOT NULL;
