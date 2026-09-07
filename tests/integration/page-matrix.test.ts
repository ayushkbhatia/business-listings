import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { pageMatrix } from "@/lib/content/matrix";
import { categoryHealth, CATEGORY_RULES_SELECT } from "@/lib/taxonomy/service";
import { countWords } from "@/lib/publish-threshold";
import { landingStats } from "@/lib/seo/landing/stats";
import { landingState, toLandingCategory, type LandingScope } from "@/lib/seo/landing/scope";
import { EXPIRED_LICENCE_TIER, VERIFIED_TIER } from "@/lib/verification";

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

/**
 * Which rung the verified share counts, pinned.
 *
 * Board 3e's handoff raised this and it is deliberately not a bug hunt: every
 * counter below already reads `verificationTier >= VERIFIED_TIER`, so the code
 * agrees with itself today. What was missing is anything that would notice if
 * one of them stopped agreeing.
 *
 * It matters because the number moves on its own. `sweepExpiredLicences` drops
 * a lapsed listing to `EXPIRED_LICENCE_TIER`, which is 1, and 1 is below the
 * share. So a wave of licence expiries lowers a trade's verified share without
 * anybody editing anything, and can take a live area page under
 * `verifiedShareMin` and unpublish it. **That behaviour is correct** — a page
 * whose suppliers are no longer verified should not claim they are — and the
 * point of this block is that it is stated rather than discovered at two in the
 * morning by whoever is looking at the sitemap.
 *
 * Four counters, because `lib/verification.ts` already explains what one loose
 * definition costs: the page matrix and the taxonomy screen once read tier 1
 * while every public surface read 2, and a category could show "publishes" on
 * board 6f while the sitemap held it out. Criterion 12 is "sitemap page count
 * matches the admin matrix exactly", and it was live before handoff 5.
 *
 * The fixture is its own category so nothing else on the matrix moves, and
 * every listing in it is otherwise identical: same trade, same area, same
 * publication state. The only variable is the rung.
 */
describe("the verified share counts tier 2 and up, and nothing lower", () => {
  const PREFIX = "vshare-pin-";
  let categoryId: string;
  let areaId: string;
  let scope: LandingScope;

  beforeAll(async () => {
    const parent = await prisma.category.findFirstOrThrow({
      where: { parentId: null },
      select: { id: true, slug: true, name: true },
    });
    const category = await prisma.category.create({
      data: {
        slug: `${PREFIX}trade`,
        name: "Verified share pin",
        code: "VP",
        parentId: parent.id,
      },
      select: { id: true, slug: true, name: true, parentId: true },
    });
    categoryId = category.id;

    const area = await prisma.area.findFirstOrThrow({
      where: { emirate: "dubai" },
      select: { id: true, slug: true, name: true, emirate: true },
    });
    areaId = area.id;

    /*
       One listing per rung, and the rungs are the whole ladder. Tier 1 is the
       interesting one: it is where an expired licence lands, so it is the row
       that decides whether a sweep can move a published page.
    */
    for (const tier of [0, 1, 2] as const) {
      await prisma.business.create({
        data: {
          tradeName: `Share Pin ${tier}`,
          displayName: `Share Pin ${tier}`,
          slug: `${PREFIX}${tier}`,
          licenceNumber: `DED-VS${tier}00001`,
          licenceAuthority: "DED",
          licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
          primaryCategoryId: categoryId,
          claimStatus: tier === 0 ? "unclaimed" : "claimed",
          publishedAt: new Date(),
          verificationTier: tier,
          verifiedAt: tier > 0 ? new Date() : null,
          locations: {
            create: {
              type: "trade_counter",
              emirate: "dubai",
              areaId,
              addressLine: "Unit 1, Street 1",
              published: true,
            },
          },
        },
      });
    }

    scope = {
      kind: "area",
      emirate: "dubai",
      area: { id: area.id, slug: area.slug, name: area.name, lat: null, lng: null },
      category: toLandingCategory(
        await prisma.category.findUniqueOrThrow({
          where: { id: categoryId },
          select: {
            id: true,
            slug: true,
            name: true,
            parentId: true,
            ...CATEGORY_RULES_SELECT,
            parent: { select: { slug: true, name: true } },
          },
        }),
      ),
      categoryIds: [categoryId],
      path: `/dubai/${area.slug}/${category.slug}`,
    };
  }, 60_000);

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  });

  it("counts one of the three on the page matrix", async () => {
    const matrix = await pageMatrix();
    const row = matrix.rows.find((candidate) => candidate.id === categoryId)!;

    expect(row.listings).toBe(3);
    expect(row.verified).toBe(1);
    // A third, not two thirds. Reading tier 1 as verified would say 0.667 and
    // clear `verifiedShareMin` (0.30) on supply that has not been checked.
    expect(row.verifiedShare).toBeCloseTo(1 / 3, 5);
  }, 60_000);

  it("counts the same one on the taxonomy screen", async () => {
    const health = await categoryHealth();
    const entry = health.find((candidate) => candidate.id === categoryId)!;
    expect(entry.verified).toBe(1);
    expect(entry.listings).toBe(3);
  }, 60_000);

  it("counts the same one in the landing page's own stats", async () => {
    const stats = await landingStats(scope);
    expect(stats.listings).toBe(3);
    expect(stats.verified).toBe(1);
  }, 60_000);

  it("counts the same one in the decision that publishes or holds the page", async () => {
    /*
       The counter that actually has a consequence. `landingState` is what
       decides whether an area page is live, and it is the path a licence-expiry
       sweep travels down: a listing drops 2 → 1, the share falls, and a page
       that was publishing stops.
    */
    const state = await landingState(scope);
    expect(state.listings).toBe(3);
    expect(state.verified).toBe(1);
  }, 60_000);

  it("moves when a licence expiry drops a listing to tier 1, and that is the point", async () => {
    /*
       The sweep's effect, reproduced without running the sweep — what matters
       is the arithmetic downstream of the rung, not the job that writes it.
       `EXPIRED_LICENCE_TIER` is imported rather than written as 1, because if
       the floor ever moves to 2 this test should start failing loudly rather
       than quietly keep asserting about a rung nothing lands on.
    */
    expect(EXPIRED_LICENCE_TIER).toBeLessThan(VERIFIED_TIER);

    await prisma.business.update({
      where: { slug: `${PREFIX}2` },
      data: { verificationTier: EXPIRED_LICENCE_TIER },
    });

    const after = await landingState(scope);
    expect(after.listings).toBe(3);
    expect(after.verified).toBe(0);

    await prisma.business.update({
      where: { slug: `${PREFIX}2` },
      data: { verificationTier: VERIFIED_TIER },
    });
  }, 60_000);
});
