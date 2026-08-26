import "server-only";
import { prisma } from "@/lib/db/client";
import { countWords, evaluatePublish } from "@/lib/publish-threshold";
import { thresholdsFor } from "@/lib/taxonomy/service";

/**
 * Board 6f — the SEO page matrix.
 *
 * Every landing page the directory generates, and whether it has anything on
 * it. The point is not a list of URLs: it is which of them are thin, because a
 * category page with a heading and a grid of results is a page search engines
 * have nothing to rank and a buyer has no reason to trust.
 *
 * Three gates, all of which have existed since handoff 0:
 *
 *   - `publishThreshold` — listings in the category.
 *   - `verifiedShareMin` — how many of them we have checked.
 *   - 250 intro words — which was unmeasurable until `Category.intro` existed,
 *     and so passed vacuously on every page.
 *
 * The third is the one this screen adds, and it is the one staff can act on
 * today: a thin category cannot be fixed by wishing more suppliers into it.
 */

export interface MatrixRow {
  id: string;
  /** The path a visitor would type. */
  path: string;
  name: string;
  /** Null for a top-level category. */
  parentName: string | null;
  listings: number;
  verified: number;
  verifiedShare: number;
  introWords: number;
  intro: string | null;
  publishable: boolean;
  /** Which gates it fails, in the order somebody would fix them. */
  failing: string[];
}

export interface Matrix {
  rows: MatrixRow[];
  publishable: number;
  /** Pages held back only by copy — the ones staff can fix this afternoon. */
  copyOnly: number;
}

export async function pageMatrix(): Promise<Matrix> {
  const [categories, counts, verifiedCounts] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }],
      select: {
        id: true, name: true, slug: true, intro: true,
        publishThreshold: true, verifiedShareMin: true,
        parent: { select: { name: true, slug: true } },
      },
    }),
    prisma.business.groupBy({
      by: ["primaryCategoryId"],
      where: { publishedAt: { not: null }, suspendedAt: null, mergedIntoId: null },
      _count: true,
    }),
    prisma.business.groupBy({
      by: ["primaryCategoryId"],
      where: {
        publishedAt: { not: null },
        suspendedAt: null,
        mergedIntoId: null,
        verificationTier: { gte: 1 },
      },
      _count: true,
    }),
  ]);

  const listings = new Map(counts.map((row) => [row.primaryCategoryId, row._count]));
  const verified = new Map(verifiedCounts.map((row) => [row.primaryCategoryId, row._count]));

  const rows: MatrixRow[] = categories.map((category) => {
    const total = listings.get(category.id) ?? 0;
    const verifiedTotal = verified.get(category.id) ?? 0;
    const introWords = countWords(category.intro);
    const thresholds = thresholdsFor(category);
    const decision = evaluatePublish(
      { listings: total, verified: verifiedTotal, introWords },
      thresholds,
    );

    /*
     * Ordered by what somebody would do about it. Copy first: it is the only
     * one of the three that is a decision rather than a wait — more listings
     * and more verifications arrive on their own schedule.
     */
    const failing: string[] = [];
    if (introWords < thresholds.minIntroWords) failing.push("copy");
    if (total < thresholds.minListings) failing.push("listings");
    if (total > 0 && verifiedTotal / total < thresholds.minVerifiedShare) {
      failing.push("verified");
    }

    return {
      id: category.id,
      path: category.parent ? `/c/${category.parent.slug}/${category.slug}` : `/c/${category.slug}`,
      name: category.name,
      parentName: category.parent?.name ?? null,
      listings: total,
      verified: verifiedTotal,
      verifiedShare: total === 0 ? 0 : verifiedTotal / total,
      introWords,
      intro: category.intro,
      publishable: decision.publishable,
      failing,
    };
  });

  return {
    rows,
    publishable: rows.filter((row) => row.publishable).length,
    // The number the screen exists for: pages that would publish today if
    // somebody wrote a paragraph.
    copyOnly: rows.filter((row) => row.failing.length === 1 && row.failing[0] === "copy").length,
  };
}
