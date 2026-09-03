/**
 * The scanner behind `pnpm db:pending`, and specifically the two ways it could
 * lie to somebody about to deploy: reporting a statement that is not there, and
 * missing one that is.
 *
 * Every fixture here is shaped after a migration this repo actually holds. The
 * line numbers are asserted because they are the part that is useless when
 * wrong — a finding says `L171` and that has to open the file at the statement
 * it names.
 */
import { describe, expect, it } from "vitest";

import { scan, statements } from "@/scripts/migration-sql.mjs";

describe("statements", () => {
  it("keeps a dollar-quoted body whole", () => {
    // 20260903213000_product_questions and eight others wrap DDL in a DO block.
    // Splitting on the semicolons inside it would report four fragments and
    // lose the one statement that matters.
    const parsed = statements(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'x') THEN
    ALTER TABLE "product" ADD CONSTRAINT "x" CHECK ("qty" > 0);
  END IF;
END $$;
`);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.line).toBe(2);
  });

  it("does not read a comment as SQL", () => {
    // 20260827030000_dunning_start_date prints the constraint it is replacing
    // in prose above the one it writes. Matching raw text reports the prose.
    const findings = scan(`
-- ALTER TABLE "subscription" DROP COLUMN "past_due_since";
/* DROP TABLE "subscription"; */
CREATE TABLE "note" ("id" TEXT NOT NULL);
`);

    expect(findings).toEqual([]);
  });

  it("does not read a string literal as SQL", () => {
    const findings = scan(`INSERT INTO "note" ("body") VALUES ('DROP TABLE "business"; -- x');`);

    expect(findings).toEqual([]);
  });

  it("counts lines through comments and bodies", () => {
    const findings = scan(`-- one
/* two
   three */
DO $$
BEGIN
  PERFORM 1;
END $$;
ALTER TABLE "business" DROP COLUMN "import_run_id";
`);

    expect(findings).toEqual([
      expect.objectContaining({ severity: "loss", line: 8 }),
    ]);
  });
});

describe("scan", () => {
  it("finds the statement that loses data", () => {
    // 20260826140000_licence_ingest, line 171. The one that would have shipped
    // unseen on 2026-09-03 had it been written that day.
    const findings = scan(`ALTER TABLE "business" DROP COLUMN "import_run_id";`);

    expect(findings).toEqual([
      expect.objectContaining({ severity: "loss", line: 1 }),
    ]);
  });

  it("finds the statement that rewrites data", () => {
    // 20260903102207_restock_watches_and_stock_freshness backfills a column.
    const findings = scan(
      `UPDATE "product" SET "stock_updated_at" = "updated_at" WHERE "stock_qty" IS NOT NULL;`,
    );

    expect(findings).toEqual([
      expect.objectContaining({ severity: "rewrite", line: 1 }),
    ]);
  });

  it("reads a multi-line ALTER as one statement", () => {
    const findings = scan(`ALTER TABLE "product"
  ALTER COLUMN "sku"
  SET NOT NULL;`);

    expect(findings).toEqual([
      expect.objectContaining({ severity: "lock", line: 1 }),
    ]);
  });

  it("sees a DROP inside a DO block", () => {
    const findings = scan(`DO $$ BEGIN ALTER TABLE "business" DROP COLUMN "x"; END $$;`);

    expect(findings[0]?.severity).toBe("loss");
  });

  it("says nothing about a constraint on a table the same migration creates", () => {
    const findings = scan(`
CREATE TABLE "review" ("id" TEXT NOT NULL, "overall" INTEGER NOT NULL);
ALTER TABLE "review" ADD CONSTRAINT "review_scores_range" CHECK ("overall" BETWEEN 1 AND 5);
`);

    expect(findings).toEqual([]);
  });

  it("still reports a constraint on a table it did not create", () => {
    const findings = scan(
      `ALTER TABLE "review" ADD CONSTRAINT "review_scores_range" CHECK ("overall" BETWEEN 1 AND 5);`,
    );

    expect(findings[0]?.severity).toBe("lock");
  });

  it("says nothing about the drop half of an idempotent index", () => {
    // docs/database.md requires every hand-written index migration to be
    // idempotent. The DROP is that requirement, not somebody losing an index.
    const findings = scan(`
DROP INDEX IF EXISTS "product_search_text_idx";
CREATE INDEX IF NOT EXISTS "product_search_text_idx" ON "product" USING GIN ("search_text");
`);

    expect(findings).toEqual([]);
  });

  it("still reports a drop of an index it does not recreate", () => {
    const findings = scan(`DROP INDEX IF EXISTS "product_search_text_idx";`);

    expect(findings[0]?.severity).toBe("lock");
  });

  it("reports nothing for a plain additive migration", () => {
    // 20260903132133_testimonial — the one that shipped unnoticed. It is
    // genuinely harmless, and the report should say so rather than cry wolf.
    const findings = scan(`
CREATE TABLE "testimonial" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    CONSTRAINT "testimonial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "testimonial_business_id_idx" ON "testimonial"("business_id");
`);

    expect(findings).toEqual([]);
  });
});
