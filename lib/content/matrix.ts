import "server-only";
import { prisma } from "@/lib/db/client";
import {
  countWords,
  evaluateHold,
  evaluatePublish,
  listingsNeeded,
  type PublishFailure,
} from "@/lib/publish-threshold";
import { byOpportunity, pageState, type PageStatus } from "@/lib/content/status";
import {
  CATEGORY_RULES_SELECT,
  thresholdsFor,
  type CategoryRules,
} from "@/lib/taxonomy/service";
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

/**
 * The gates a row fails, in the order somebody would fix them.
 *
 * One vocabulary for all three tables on this screen. It was three: the
 * category rows re-derived the comparisons by hand from the same numbers
 * `evaluatePublish` had just compared — and disagreed with it whenever a
 * category held no listings at all, because the hand-written guard read
 * `total > 0` where the shared function divides by a guarded zero and refuses.
 * The area rows mapped the real failures but the emirate rows joined the raw
 * enum into a sentence, so two sibling tables told a reader "needs copy" and
 * "intro_words" about the same condition, one of them untranslated.
 *
 * Copy first, because it is the only gate that is a decision rather than a
 * wait: more listings and more verifications arrive on their own schedule.
 */
export type MatrixGate = "copy" | "listings" | "verified" | "faq";

export function matrixGates(failures: readonly PublishFailure[]): MatrixGate[] {
  const gates: MatrixGate[] = [];
  if (failures.some((f) => f.reason === "intro_words")) gates.push("copy");
  if (failures.some((f) => f.reason === "listings")) gates.push("listings");
  if (failures.some((f) => f.reason === "verified_share")) gates.push("verified");
  /*
     Board 6a's fourth condition, as one label rather than two.

     "4 rows, 2 of them local" is one thing to fix — a writer opens the panel
     and writes questions. Splitting it into `faq` and `faq_local` would put two
     chips on a row that describe the same afternoon's work, and `isCopyOnly`
     would stop meaning what it says.
  */
  if (failures.some((f) => f.reason === "faq_rows" || f.reason === "faq_scope_specific")) {
    gates.push("faq");
  }
  return gates;
}

/**
 * Held back only by things a person can fix this afternoon.
 *
 * The paragraph and the questions both count, and this is the second sense the
 * count has carried since board 6a — which the area rows did not honour: they
 * asked for exactly `["copy"]`, so a page whose only outstanding gate was four
 * missing questions was excluded from the number whose comment said it was
 * included.
 */
export function isCopyOnly(gates: readonly MatrixGate[]): boolean {
  return gates.length > 0 && gates.every((gate) => gate === "copy" || gate === "faq");
}

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
  /** This trade's own word floor, which the editor colours against. */
  minWords: number;
  /** Which gates it fails, in the order somebody would fix them. */
  failing: MatrixGate[];
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
        ...CATEGORY_RULES_SELECT,
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

    const failing = matrixGates(decision.failures);

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
      minWords: thresholds.minIntroWords,
      failing,
    };
  });

  return {
    rows,
    publishable: rows.filter((row) => row.publishable).length,
    // The number the screen exists for: pages that would publish today if
    // somebody wrote a paragraph.
    copyOnly: rows.filter((row) => isCopyOnly(row.failing)).length,
  };
}

/**
 * Board 6f's matrix: one row per area, for a category and an emirate.
 *
 * Not "every authored page". The row set is every area in the emirate crossed
 * with the selected trade, because the rows that matter most are the ones with
 * no page at all — a scope with 2,260 searches a month and two listings is the
 * state the board calls `Recruit`, and it is the work. A screen that listed
 * only authored pairs would show the pages somebody has already thought about
 * and hide the ones nobody has.
 *
 * It is one round trip per data kind rather than one per row. The previous cut
 * called `areaPageState` in a loop, which was a query per authored pair; at one
 * row per area that would be forty queries for HVAC in Dubai alone.
 */
export interface AreaMatrixRow {
  areaId: string;
  categoryId: string;
  path: string;
  areaName: string;
  emirate: string;
  categoryName: string;
  listings: number;
  verified: number;
  /** The higher of the absolute and demand-relative floors — `have / need`. */
  need: number;
  needBasis: "absolute" | "demand";
  shortfall: number;
  opportunity: number;
  /** Null where nobody has recorded a figure. The column prints an em dash. */
  monthlySearches: number | null;
  demandSource: string | null;
  demandCapturedAt: Date | null;
  introWords: number;
  minIntroWords: number;
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
  relatedSearches: { label: string; href: string }[];
  /** Staff have published it. Not the same as live. */
  published: boolean;
  /** Published, not held, and holding its floors or its minimum-live window. */
  live: boolean;
  heldAt: Date | null;
  heldReason: string | null;
  status: PageStatus;
  failing: MatrixGate[];
}

export interface AreaMatrix {
  rows: AreaMatrixRow[];
  /** Rows matching the filter before the page slice. The footer states it. */
  total: number;
  live: number;
  /** Rows a person could fix this afternoon by writing a paragraph. */
  copyOnly: number;
  /** The largest opportunity in the whole filtered set, not just this page. */
  topOpportunity: AreaMatrixRow | null;
}

export interface AreaMatrixFilter {
  categoryId?: string;
  emirate?: string;
  /** One-based. The list is long: HVAC in Dubai is forty-odd areas. */
  page?: number;
  perPage?: number;
  /**
   * Rules to compute against instead of the ones on the category row.
   *
   * The impact preview in board 6f §5 is this matrix run twice — once on the
   * live rules and once on the proposed ones — and the difference between the
   * two answers is "publishes 214, unpublishes 3". Nothing is written, and
   * every other caller passes nothing and reads the live rules.
   */
  rules?: Partial<CategoryRules>;
}

export const AREA_ROWS_PER_PAGE = 25;

interface SupplyRow {
  area_id: string;
  category_id: string;
  listings: bigint;
  verified: bigint;
}

export async function areaMatrix(
  filter: AreaMatrixFilter = {},
  now = new Date(),
): Promise<AreaMatrix> {
  const [categories, areas, supply, pages, demand] = await Promise.all([
    prisma.category.findMany({
      where: filter.categoryId ? { id: filter.categoryId } : {},
      select: { id: true, name: true, slug: true, parentId: true, ...CATEGORY_RULES_SELECT },
    }),
    prisma.area.findMany({
      where: filter.emirate ? { emirate: filter.emirate as never } : {},
      orderBy: [{ emirate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, emirate: true },
    }),
    /*
       Supply for every (area, category) pair in one read.

       Grouped on `primary_category_id` rather than the sector, because the
       matrix is per trade and a subcategory rolls up into its parent below.
       `DISTINCT b.id` because a supplier with three published locations in one
       area is one supplier there, not three.
    */
    prisma.$queryRaw<SupplyRow[]>`
      SELECT l.area_id,
             b.primary_category_id AS category_id,
             COUNT(DISTINCT b.id) AS listings,
             COUNT(DISTINCT b.id) FILTER (WHERE b.verification_tier >= ${VERIFIED_TIER}) AS verified
        FROM business b
        JOIN location l ON l.business_id = b.id AND l.published = true
       WHERE b.suspended_at IS NULL
         AND b.published_at IS NOT NULL
         AND l.area_id IS NOT NULL
       GROUP BY l.area_id, b.primary_category_id
    `,
    prisma.areaPage.findMany({
      where: {
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.emirate ? { area: { emirate: filter.emirate as never } } : {}),
      },
      select: {
        areaId: true,
        categoryId: true,
        intro: true,
        metaDescription: true,
        publishedAt: true,
        firstPublishedAt: true,
        heldAt: true,
        heldReason: true,
        faq: {
          orderBy: { position: "asc" },
          select: { question: true, answer: true, scopeSpecific: true, liveToken: true },
        },
        relatedSearches: { orderBy: { position: "asc" }, select: { label: true, href: true } },
      },
    }),
    prisma.scopeDemand.findMany({
      where: {
        areaId: { not: null },
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.emirate ? { emirate: filter.emirate as never } : {}),
      },
      select: {
        areaId: true,
        categoryId: true,
        monthlySearches: true,
        source: true,
        capturedAt: true,
      },
    }),
  ]);

  // Subcategories roll up into their parent, the way every other count of a
  // trade in this product does: a buyer reading "HVAC" wants the trade's whole
  // size, not an accident of how precisely each listing was filed.
  const descendants = new Map<string, string[]>();
  for (const category of categories) descendants.set(category.id, [category.id]);
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } });
  for (const child of all) {
    if (child.parentId === null) continue;
    descendants.get(child.parentId)?.push(child.id);
  }

  const supplyFor = new Map<string, { listings: number; verified: number }>();
  for (const row of supply) {
    supplyFor.set(`${row.area_id}:${row.category_id}`, {
      listings: Number(row.listings),
      verified: Number(row.verified),
    });
  }
  const pageFor = new Map(pages.map((page) => [`${page.areaId}:${page.categoryId}`, page]));
  const demandFor = new Map(demand.map((row) => [`${row.areaId}:${row.categoryId}`, row]));

  const rows: AreaMatrixRow[] = [];
  for (const area of areas) {
    for (const category of categories) {
      // Sectors only. A subcategory has no landing page of its own — board 6a
      // routes `/:emirate/:area/:category` at the trade, and its children are
      // chips on that page.
      if (category.parentId !== null) continue;

      let listings = 0;
      let verified = 0;
      for (const id of descendants.get(category.id) ?? []) {
        const found = supplyFor.get(`${area.id}:${id}`);
        if (!found) continue;
        listings += found.listings;
        verified += found.verified;
      }

      const page = pageFor.get(`${area.id}:${category.id}`);
      const recorded = demandFor.get(`${area.id}:${category.id}`);
      const rules: CategoryRules = { ...category, ...(filter.rules ?? {}) };
      const thresholds = thresholdsFor(rules);
      const introWords = countWords(page?.intro);
      const faq = page?.faq ?? [];
      const input = {
        listings,
        verified,
        introWords,
        faqRows: page ? faq.length : undefined,
        scopeSpecificFaqRows: page ? faq.filter((row) => row.scopeSpecific).length : undefined,
        // Never `?? 0`: an absent figure is the absolute floor, and treating it
        // as nought would pass every unmeasured scope for the wrong reason.
        monthlySearches: recorded?.monthlySearches ?? undefined,
      };
      const decision = evaluatePublish(input, thresholds);
      const hold = evaluateHold(input, thresholds);
      const { need, basis } = listingsNeeded(input, thresholds);

      const withinGrace =
        page?.firstPublishedAt != null &&
        now.getTime() - page.firstPublishedAt.getTime() < rules.minLiveDays * DAY_MS;
      // The same three clauses `landingState` applies, in the same order. If
      // this screen and the route ever disagree, one of them is lying to staff.
      const live =
        page?.publishedAt != null &&
        page.heldAt == null &&
        (hold.publishable ||
          (withinGrace && hold.failures.every((failure) => failure.reason === "listings")));

      const state = pageState({
        live,
        heldAt: page?.heldAt ?? null,
        listings,
        need,
        introWords,
        minIntroWords: rules.minIntroWords,
        monthlySearches: recorded?.monthlySearches ?? null,
      });

      rows.push({
        areaId: area.id,
        categoryId: category.id,
        path: `/${area.emirate}/${area.slug}/${category.slug}`,
        areaName: area.name,
        emirate: area.emirate,
        categoryName: category.name,
        listings,
        verified,
        need,
        needBasis: basis,
        shortfall: state.shortfall,
        opportunity: state.opportunity,
        monthlySearches: recorded?.monthlySearches ?? null,
        demandSource: recorded?.source ?? null,
        demandCapturedAt: recorded?.capturedAt ?? null,
        introWords,
        minIntroWords: rules.minIntroWords,
        intro: page?.intro ?? null,
        metaDescription: page?.metaDescription ?? null,
        faq: faq.map((row) => ({
          question: row.question,
          answer: row.answer,
          scopeSpecific: row.scopeSpecific,
          liveToken: row.liveToken,
        })),
        relatedSearches: (page?.relatedSearches ?? []).map((row) => ({
          label: row.label,
          href: row.href,
        })),
        published: page?.publishedAt != null,
        live,
        heldAt: page?.heldAt ?? null,
        heldReason: page?.heldReason ?? null,
        status: state.status,
        failing: matrixGates(decision.failures),
      });
    }
  }

  rows.sort(byOpportunity);

  const perPage = filter.perPage ?? AREA_ROWS_PER_PAGE;
  const start = Math.max(0, ((filter.page ?? 1) - 1) * perPage);

  return {
    rows: rows.slice(start, start + perPage),
    total: rows.length,
    live: rows.filter((row) => row.live).length,
    copyOnly: rows.filter((row) => isCopyOnly(row.failing)).length,
    // From the whole filtered set, not the visible slice. The footer states the
    // top opportunity in prose, and a top that changed as somebody paged
    // through would be a different sentence on every page.
    topOpportunity: rows.find((row) => row.opportunity > 0) ?? null,
  };
}

const DAY_MS = 86_400_000;
