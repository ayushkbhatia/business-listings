import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { pageMatrix } from "@/lib/content/matrix";
import { categoryHealth } from "@/lib/taxonomy/service";
import { countWords } from "@/lib/publish-threshold";

/**
 * Board 6f — the page matrix.
 *
 * The gate this adds is the intro word count, which has been in
 * `thresholdsFor` since handoff 0 and passed vacuously the whole time: there
 * was nowhere for a category's copy to live, so `categoryHealth` took the count
 * as a parameter and defaulted it to `MAX_SAFE_INTEGER`.
 */

describe("what the matrix counts", () => {
  it("lists every category and subcategory as its own page", async () => {
    const [matrix, categories] = await Promise.all([
      pageMatrix(),
      prisma.category.count(),
    ]);
    expect(matrix.rows).toHaveLength(categories);
  }, 60_000);

  it("builds the path a visitor would type", async () => {
    const matrix = await pageMatrix();
    const parent = matrix.rows.find((row) => row.parentName === null)!;
    const child = matrix.rows.find((row) => row.parentName !== null);

    expect(parent.path).toMatch(/^\/c\/[a-z0-9-]+$/);
    if (child) expect(child.path).toMatch(/^\/c\/[a-z0-9-]+\/[a-z0-9-]+$/);
  }, 60_000);

  it("counts the words in the copy, and nought where there is none", async () => {
    const matrix = await pageMatrix();
    for (const row of matrix.rows) {
      expect(row.introWords, row.path).toBe(countWords(row.intro));
      if (!row.intro) expect(row.introWords, row.path).toBe(0);
    }
  }, 60_000);

  it("sorts copy first among the gates, because it is the only one somebody can fix", async () => {
    /*
     * More listings and more verifications arrive on their own schedule. A
     * paragraph does not, which is why a page failing all three should lead
     * with the one that is a decision.
     *
     * Asserted as "copy leads wherever copy fails" rather than the older "any
     * page failing more than one gate leads with copy". The two read alike and
     * are not the same claim: `matrix.ts` pushes copy first unconditionally, so
     * the old form could only ever fire when copy *passed* — which made it an
     * assertion that no category fails both `listings` and `verified` while
     * having its paragraph written. That is a fact about seed data, not about
     * the sort, and this suite runs against a database twenty-six earlier test
     * files have already written to. It went red in CI on a category sitting at
     * two listings, where a handful of unverified rows from anywhere in the
     * suite drops the verified share under thirty per cent.
     *
     * The property the comment above describes is the one now being tested.
     */
    const matrix = await pageMatrix();
    for (const row of matrix.rows) {
      if (row.failing.includes("copy")) expect(row.failing[0], row.path).toBe("copy");
    }
  }, 60_000);

  it("counts the pages waiting only on a paragraph", async () => {
    const matrix = await pageMatrix();
    const byHand = matrix.rows.filter(
      (row) => row.failing.length === 1 && row.failing[0] === "copy",
    ).length;
    expect(matrix.copyOnly).toBe(byHand);
  }, 60_000);
});

describe("the gate that used to pass vacuously", () => {
  it("fails a category with no copy at all", async () => {
    const matrix = await pageMatrix();
    const empty = matrix.rows.filter((row) => row.introWords === 0);
    expect(empty.length, "the seed leaves some pages unwritten on purpose").toBeGreaterThan(0);
    for (const row of empty) {
      expect(row.publishable, row.path).toBe(false);
      expect(row.failing, row.path).toContain("copy");
    }
  }, 60_000);

  it("agrees with categoryHealth, which reads the same column now", async () => {
    // Two readers, one source. `categoryHealth` used to take the word count as
    // an argument nobody supplied.
    const [matrix, health] = await Promise.all([pageMatrix(), categoryHealth()]);
    for (const row of matrix.rows) {
      const entry = health.find((candidate) => candidate.id === row.id)!;
      expect(entry.introWords, row.path).toBe(row.introWords);
      expect(entry.decision.publishable, row.path).toBe(row.publishable);
    }
  }, 60_000);

  it("passes a category whose copy clears the floor", async () => {
    const matrix = await pageMatrix();
    const written = matrix.rows.filter((row) => row.introWords >= 250);
    expect(written.length, "the seed writes two of them").toBeGreaterThan(0);
    for (const row of written) {
      expect(row.failing, row.path).not.toContain("copy");
    }
  }, 60_000);
});

describe("the copy reaches the page it was written for", () => {
  it("is stored against the category the matrix names", async () => {
    const matrix = await pageMatrix();
    const written = matrix.rows.find((row) => row.introWords >= 250)!;
    const category = await prisma.category.findUniqueOrThrow({
      where: { id: written.id },
      select: { intro: true, slug: true },
    });
    expect(category.intro).toBe(written.intro);
    expect(written.path).toContain(category.slug);
  }, 60_000);
});
