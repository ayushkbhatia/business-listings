-- A line with no quantity — the wave 5 blocker, both halves.
--
-- An audit is not ordered by the dozen. `qty` was `Int` and NOT NULL on both
-- line tables, so every service enquiry carried a `1` that meant nothing and
-- three render sites printed it as `×1`. `QuoteLine.qty` is the harder half and
-- neither planning document names it: `sendQuote` refuses `qty < 1`, so it
-- gates the **accepted quote** — the terminal state of the whole product. A
-- service enquiry that cannot be quoted cannot convert.
--
-- **Widening, not narrowing.** Dropping NOT NULL accepts everything the column
-- accepted before, so code that still writes a quantity keeps working and this
-- applies **before** the deploy that starts writing nulls —
-- `docs/deployments.md` § Ordering. No existing row changes.
--
-- Idempotent: `DROP NOT NULL` on a column that is already nullable is a no-op.

ALTER TABLE "enquiry_line" ALTER COLUMN "qty" DROP NOT NULL;
ALTER TABLE "quote_line"   ALTER COLUMN "qty" DROP NOT NULL;

-- `quote_line_qty_positive` is deliberately left alone.
--
-- A Postgres CHECK fails only on FALSE, and `NULL > 0` is NULL — so "greater
-- than nought" keeps meaning exactly what it said for every row that has a
-- quantity, and says nothing about the rows that do not. Rewriting it as
-- `qty IS NULL OR qty > 0` would be the same constraint spelled longer.
