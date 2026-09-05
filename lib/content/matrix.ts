import "server-only";
import { prisma } from "@/lib/db/client";
import { countWords, evaluatePublish } from "@/lib/publish-threshold";
import { thresholdsFor } from "@/lib/taxonomy/service";
import { VERIFIED_TIER } from "@/lib/verification";

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
        verificationTier: { gte: VERIFIED_TIER },
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
    /*
       Copy, now in two senses: the paragraph and the questions. Both are things
       a person can fix this afternoon, and neither is a wait for recruitment —
       which is the distinction this number exists to draw.
    */
    copyOnly: rows.filter(
      (row) =>
        row.failing.length > 0 && row.failing.every((gate) => gate === "copy" || gate === "faq"),
    ).length,
  };
}

/**
 * Board 6a's rows, for the same screen — and for criterion 12.
 *
 *   "Sitemap contains only published pages, and page count matches the admin
 *    matrix [6f] exactly."
 *
 * Area pages are the largest population in the sitemap, so a matrix that
 * covered only categories could not answer that at all. These rows come from
 * `areaPageState`, which is the same function the route and the sitemap read —
 * one computation, three surfaces, no way for them to disagree.
 *
 * Only pairs that have a row are listed. Every area × every trade is a few
 * thousand combinations, almost all of them empty, and a screen that listed
 * them would bury the dozen somebody can act on.
 */
export interface AreaMatrixRow {
  areaId: string;
  categoryId: string;
  path: string;
  areaName: string;
  categoryName: string;
  listings: number;
  verified: number;
  introWords: number;
  /** The paragraph itself, so the editor opens with what is there. */
  intro: string | null;
  /** The written sentence, board 6a §SEO. Null falls back to a derived one. */
  metaDescription: string | null;
  /** The per-scope questions — board 6a's fourth condition. */
  faq: {
    question: string;
    answer: string;
    scopeSpecific: boolean;
    liveToken: string | null;
  }[];
  /** The RELATED SEARCHES card, capped at five. */
  relatedSearches: { label: string; href: string }[];
  /** Staff have published it. Not the same as live. */
  published: boolean;
  /** Published and the four conditions currently hold. */
  live: boolean;
  failing: string[];
}

export interface AreaMatrix {
  rows: AreaMatrixRow[];
  live: number;
  /** Rows a person could fix this afternoon by writing a paragraph. */
  copyOnly: number;
}

export async function areaMatrix(): Promise<AreaMatrix> {
  const { areaPageState } = await import("@/lib/seo/area");

  const pages = await prisma.areaPage.findMany({
    orderBy: [{ area: { name: "asc" } }, { category: { name: "asc" } }],
    select: {
      areaId: true,
      categoryId: true,
      metaDescription: true,
      area: { select: { slug: true, name: true, emirate: true } },
      category: { select: { slug: true, name: true } },
      /*
         The content records the editor opens with. Read here rather than in a
         second query per row that the editor fires on open: this screen already
         walks every authored pair, and a panel that has to fetch before it can
         show what is there is a panel that flashes empty.
      */
      relatedSearches: {
        orderBy: { position: "asc" },
        select: { label: true, href: true },
      },
    },
  });

  const rows: AreaMatrixRow[] = [];
  for (const page of pages) {
    const state = await areaPageState(page.areaId, page.categoryId);
    if (!state) continue;

    // Same order as the category rows: copy first, because it is the only one
    // of the three that is a decision rather than a wait.
    const failing: string[] = [];
    if (state.failing.some((f) => f.reason === "intro_words")) failing.push("copy");
    if (state.failing.some((f) => f.reason === "listings")) failing.push("listings");
    if (state.failing.some((f) => f.reason === "verified_share")) failing.push("verified");
    /*
       Board 6a's fourth condition, as one label rather than two.

       "4 rows, 2 of them local" is one thing to fix — a writer opens the panel
       and writes questions. Splitting it into `faq` and `faq_local` would put
       two chips on a row that describe the same afternoon's work, and
       `copyOnly` would stop meaning what it says.
    */
    if (state.failing.some((f) => f.reason === "faq_rows" || f.reason === "faq_scope_specific")) {
      failing.push("faq");
    }

    rows.push({
      areaId: page.areaId,
      categoryId: page.categoryId,
      path: `/${page.area.emirate}/${page.area.slug}/${page.category.slug}`,
      areaName: page.area.name,
      categoryName: page.category.name,
      listings: state.listings,
      verified: state.verified,
      introWords: state.introWords,
      intro: state.intro,
      metaDescription: page.metaDescription,
      faq: state.faq.map((row) => ({
        question: row.question,
        answer: row.answer,
        scopeSpecific: row.scopeSpecific,
        liveToken: row.liveToken,
      })),
      relatedSearches: page.relatedSearches.map((row) => ({ label: row.label, href: row.href })),
      published: state.publishedAt !== null,
      live: state.live,
      failing,
    });
  }

  return {
    rows,
    live: rows.filter((row) => row.live).length,
    copyOnly: rows.filter((row) => row.failing.length === 1 && row.failing[0] === "copy").length,
  };
}
