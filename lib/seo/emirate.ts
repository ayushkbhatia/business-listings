import "server-only";
import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  DEFAULT_THRESHOLDS,
  evaluatePublish,
  type PublishFailure,
  type PublishThresholds,
} from "@/lib/publish-threshold";

/**
 * The emirate × sector landing page — `/:emirate/:category`.
 *
 * Board 6c's matrix is twelve sectors by seven emirates and calls the result
 * "84 pages". Until now those pages did not exist: `AreaPage` is keyed on
 * (area, category), and an area is "Al Quoz Industrial 1" rather than Dubai, so
 * "HVAC in Dubai" had no URL for the matrix to point at. This is that URL.
 *
 * ## Where the intro comes from
 *
 * Board 6f's third gate is 250 words of genuine copy, and there is no
 * `EmiratePage` table to hold one. Rather than add a table and an admin screen
 * for it, the gate reads the sector's own `Category.intro` — which already
 * exists, is already word-counted by the page matrix, and is already edited in
 * the taxonomy admin.
 *
 * The cost is worth stating plainly: seven emirate pages for one sector share
 * one paragraph. What differentiates them is everything else on the page — the
 * counts, the supplier list, the area breakdown — and that is real. If these
 * pages ever earn their own copy, this is the function that changes and the
 * table arrives behind it.
 *
 * ## Why the floors are re-checked and never cached
 *
 * `livePages` in the area module makes the same choice for the same reason: a
 * page whose supply dropped this morning must stop being indexable in the same
 * request, not when a job next runs. The matrix, the page's own robots tag and
 * the sitemap all call in here, so they cannot disagree.
 */

const PUBLIC_BUSINESS = {
  suspendedAt: null,
  publishedAt: { not: null },
} as const;

export interface EmiratePageState {
  emirate: string;
  categoryId: string;
  listings: number;
  verified: number;
  introWords: number;
  /** All three floors hold right now. */
  live: boolean;
  failing: readonly PublishFailure[];
}

function countWords(text: string | null | undefined): number {
  const trimmed = (text ?? "").trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function thresholdsFor(category: {
  publishThreshold: number;
  verifiedShareMin: number;
}): PublishThresholds {
  return {
    minListings: category.publishThreshold,
    minVerifiedShare: category.verifiedShareMin,
    minIntroWords: DEFAULT_THRESHOLDS.minIntroWords,
  };
}

/**
 * Listings in one emirate for one sector, counting the sector's children.
 *
 * A supplier filed under "Ducting" is an HVAC supplier, and a page that said
 * otherwise would disagree with the count on the card that linked to it.
 */
async function supply(emirate: string, categoryId: string) {
  const where = {
    ...PUBLIC_BUSINESS,
    OR: [{ primaryCategoryId: categoryId }, { primaryCategory: { parentId: categoryId } }],
    locations: { some: { emirate: emirate as never, published: true } },
  };
  const [listings, verified] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.count({ where: { ...where, verificationTier: { gte: VERIFIED_TIER } } }),
  ]);
  return { listings, verified };
}

export async function emirateCategoryState(
  emirate: string,
  categoryId: string,
): Promise<EmiratePageState | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { publishThreshold: true, verifiedShareMin: true, intro: true },
  });
  if (!category) return null;

  const { listings, verified } = await supply(emirate, categoryId);
  const introWords = countWords(category.intro);
  const decision = evaluatePublish(
    { listings, verified, introWords },
    thresholdsFor(category),
  );

  return {
    emirate,
    categoryId,
    listings,
    verified,
    introWords,
    live: decision.publishable,
    failing: decision.failures,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The matrix
// ─────────────────────────────────────────────────────────────────────────────

export interface MatrixCell {
  emirate: string;
  listings: number;
  /** Live means indexable: the count is a link and the URL is in the sitemap. */
  live: boolean;
}

export interface MatrixRow {
  id: string;
  slug: string;
  name: string;
  code: string;
  listings: number;
  /** This sector's own listing floor. The footnote quotes it. */
  publishThreshold: number;
  cells: MatrixCell[];
}

/** The seven, in the order the federal government lists them by size. */
export const MATRIX_EMIRATES = [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "fujairah",
  "umm_al_quwain",
] as const;

interface SupplyRow {
  sector_id: string;
  emirate: string;
  listings: bigint;
  verified: bigint;
}

/**
 * Every cell in one query, which is the spec's own requirement — "one query for
 * the matrix, not 84. This page must render in a single round trip."
 *
 * `Business.sectorId` is what makes that possible. It is the denormalised
 * top-level ancestor of `primaryCategoryId`, kept in step by a database
 * trigger, so a sector's total is one indexed column rather than a recursive
 * walk per cell. Counting `DISTINCT b.id` because a business with three
 * published locations in Dubai is one Dubai supplier, not three.
 */
export async function emirateMatrix(): Promise<MatrixRow[]> {
  const [sectors, rows] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        intro: true,
        publishThreshold: true,
        verifiedShareMin: true,
      },
    }),
    prisma.$queryRaw<SupplyRow[]>`
      SELECT b.sector_id,
             l.emirate::text AS emirate,
             COUNT(DISTINCT b.id) AS listings,
             COUNT(DISTINCT b.id) FILTER (WHERE b.verification_tier >= ${VERIFIED_TIER}) AS verified
        FROM business b
        JOIN location l ON l.business_id = b.id AND l.published = true
       WHERE b.suspended_at IS NULL
         AND b.published_at IS NOT NULL
         AND b.sector_id IS NOT NULL
       GROUP BY b.sector_id, l.emirate
    `,
  ]);

  const bySector = new Map<string, Map<string, { listings: number; verified: number }>>();
  for (const row of rows) {
    const perEmirate = bySector.get(row.sector_id) ?? new Map();
    perEmirate.set(row.emirate, {
      listings: Number(row.listings),
      verified: Number(row.verified),
    });
    bySector.set(row.sector_id, perEmirate);
  }

  return sectors
    .map((sector) => {
      const perEmirate = bySector.get(sector.id) ?? new Map();
      const introWords = countWords(sector.intro);
      const thresholds = thresholdsFor(sector);

      const cells = MATRIX_EMIRATES.map((emirate) => {
        const found = perEmirate.get(emirate) ?? { listings: 0, verified: 0 };
        const decision = evaluatePublish(
          { listings: found.listings, verified: found.verified, introWords },
          thresholds,
        );
        return { emirate, listings: found.listings, live: decision.publishable };
      });

      return {
        id: sector.id,
        slug: sector.slug,
        name: sector.name,
        code: sector.code,
        // The row's own total is the sum of its cells. A business with
        // locations in two emirates counts in both, which is what a
        // per-emirate matrix means and what each cell already says.
        listings: cells.reduce((total, cell) => total + cell.listings, 0),
        publishThreshold: sector.publishThreshold,
        cells,
      };
    })
    .sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name));
}

/**
 * The emirate pages that may be indexed, for `sitemap.ts`.
 *
 * Derived from the same matrix the page renders, so criterion 4 — the set of
 * hrefs on `/categories` equals the set of URLs in the sitemap — holds by
 * construction rather than by two functions being kept in step by hand.
 */
export async function liveEmiratePages(): Promise<
  { emirate: string; categorySlug: string }[]
> {
  const matrix = await emirateMatrix();
  return matrix.flatMap((row) =>
    row.cells
      .filter((cell) => cell.live)
      .map((cell) => ({ emirate: cell.emirate, categorySlug: row.slug })),
  );
}

/** The one place the URL shape is written down. */
export function emiratePagePath(emirate: string, categorySlug: string): string {
  return `/${emirate}/${categorySlug}`;
}
