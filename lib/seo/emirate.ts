import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
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
 * `EmiratePage`, one row per (emirate, sector), holding the paragraph and the
 * staff intent to publish. It is `AreaPage`'s twin on purpose — same two
 * authored fields, same floors, same reading of live — because the two page
 * types differ in what they are about and not in how they behave.
 *
 * This started out reading the sector's own `Category.intro` instead, to avoid
 * a table. That meant seven emirate pages sharing one paragraph: thin-content
 * risk on exactly the pages the acquisition engine depends on, and no way to
 * write something true about Sharjah that is not also true about Fujairah. The
 * table is the smaller cost.
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
  intro: string | null;
  introWords: number;
  /** Staff intent. Not the live state on its own. */
  publishedAt: Date | null;
  /** The three floors hold right now, whatever staff have decided. */
  clearsFloors: boolean;
  /** Published *and* clearing the floors. The only thing that is indexable. */
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
  const [category, page] = await Promise.all([
    prisma.category.findUnique({
      where: { id: categoryId },
      select: { publishThreshold: true, verifiedShareMin: true },
    }),
    prisma.emiratePage.findUnique({
      where: { emirate_categoryId: { emirate: emirate as never, categoryId } },
      select: { intro: true, publishedAt: true },
    }),
  ]);
  if (!category) return null;

  const { listings, verified } = await supply(emirate, categoryId);
  const introWords = countWords(page?.intro);
  const decision = evaluatePublish(
    { listings, verified, introWords },
    thresholdsFor(category),
  );

  return {
    emirate,
    categoryId,
    listings,
    verified,
    intro: page?.intro ?? null,
    introWords,
    publishedAt: page?.publishedAt ?? null,
    clearsFloors: decision.publishable,
    // Staff intent AND supply, exactly as an area page reads it.
    live: page?.publishedAt != null && decision.publishable,
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
  const [sectors, rows, pages] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
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
    /*
       Every authored page in one read. Eighty-four rows at most, and usually
       far fewer — the alternative is a lookup per cell, which is the 84 queries
       the spec forbids wearing a different hat.
    */
    prisma.emiratePage.findMany({
      select: { emirate: true, categoryId: true, intro: true, publishedAt: true },
    }),
  ]);

  const pageFor = new Map(
    pages.map((page) => [`${page.categoryId}:${page.emirate}`, page]),
  );

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
      const thresholds = thresholdsFor(sector);

      const cells = MATRIX_EMIRATES.map((emirate) => {
        const found = perEmirate.get(emirate) ?? { listings: 0, verified: 0 };
        const page = pageFor.get(`${sector.id}:${emirate}`);
        const decision = evaluatePublish(
          {
            listings: found.listings,
            verified: found.verified,
            // Each cell's own paragraph now, not the sector's one shared one.
            introWords: countWords(page?.intro),
          },
          thresholds,
        );
        return {
          emirate,
          listings: found.listings,
          live: page?.publishedAt != null && decision.publishable,
        };
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
 *
 * `cell.live` is staff intent and supply together, so an unpublished page is
 * absent from both and a published one whose supply fell this morning leaves
 * both on the next read.
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

// ─────────────────────────────────────────────────────────────────────────────
// The service half
//
// `AreaPage`'s, mirrored. Every function here writes an audit row with a
// written reason, because a staff member deciding that a page may be indexed is
// a state change somebody should be able to look up in six months.
// ─────────────────────────────────────────────────────────────────────────────

export type EmiratePageRefusal = "not_found" | "below_floors" | "not_published";

export type EmiratePageResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: EmiratePageRefusal; message: string; failing?: PublishFailure[] };

/**
 * The refusal, in numbers somebody can act on.
 *
 * "Needs 60, has 41" tells a recruiter how many calls to make. "Not eligible"
 * tells them to go and find out, which is the same information one screen
 * further away — §08.
 */
function refusalMessage(failing: readonly PublishFailure[]): string {
  return failing
    .map((failure) => {
      switch (failure.reason) {
        case "listings":
          return `${failure.have} listings, and it publishes at ${failure.need}.`;
        case "verified_share":
          return `${Math.round(failure.have * 100)}% verified, and it publishes at ${Math.round(
            failure.need * 100,
          )}%.`;
        default:
          return `${failure.have} words of intro, and it publishes at ${failure.need}.`;
      }
    })
    .join(" ");
}

async function subjectFor(emirate: string, categoryId: string): Promise<SubjectRef> {
  const category = await prisma.category.findUniqueOrThrow({
    where: { id: categoryId },
    select: { slug: true },
  });
  return `EmiratePage:${emirate}/${category.slug}` as SubjectRef;
}

export interface SaveEmirateIntroInput {
  actor: Actor;
  emirate: string;
  categoryId: string;
  intro: string;
  reason: string;
}

/** Write the paragraph. Creates the row on first save. */
export async function saveEmirateIntro(
  input: SaveEmirateIntroInput,
): Promise<EmiratePageResult<{ words: number }>> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That trade is not here." };
  }

  const intro = input.intro.trim();
  const key = { emirate: input.emirate as never, categoryId: input.categoryId };
  const subject = await subjectFor(input.emirate, input.categoryId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor: input.actor, capability: "taxonomy.write", subject, reason: input.reason, tx },
      async () => {
        const before = await tx.emiratePage.findUnique({
          where: { emirate_categoryId: key },
          select: { intro: true },
        });
        await tx.emiratePage.upsert({
          where: { emirate_categoryId: key },
          create: { ...key, intro: intro || null },
          update: { intro: intro || null },
        });
        return {
          result: null,
          // The words, not the prose. An audit row is a record of a decision,
          // and pasting two paragraphs into it twice a week is not that.
          before: { words: countWords(before?.intro) },
          after: { words: countWords(intro) },
        };
      },
    ),
  );

  return { ok: true, words: countWords(intro) };
}

/**
 * Publish one emirate page.
 *
 * The floors are checked here, in the service, which is what "cannot be
 * published by API or by admin action" means — the screen and any future API
 * call go through this and there is no second path.
 */
export async function publishEmiratePage(
  actor: Actor,
  emirate: string,
  categoryId: string,
  reason: string,
): Promise<EmiratePageResult<{ publishedAt: Date }>> {
  const state = await emirateCategoryState(emirate, categoryId);
  if (!state) return { ok: false, error: "not_found", message: "That trade is not here." };

  if (!state.clearsFloors) {
    return {
      ok: false,
      error: "below_floors",
      message: refusalMessage(state.failing),
      failing: [...state.failing],
    };
  }

  const key = { emirate: emirate as never, categoryId };
  const subject = await subjectFor(emirate, categoryId);

  const publishedAt = await prisma.$transaction(async (tx) =>
    staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      const row = await tx.emiratePage.update({
        where: { emirate_categoryId: key },
        // An already-published page keeps its original date: `lastmod` is a
        // claim about when the content changed, not when somebody clicked.
        data: { publishedAt: state.publishedAt ?? new Date() },
        select: { publishedAt: true },
      });
      return {
        result: row.publishedAt as Date,
        before: { publishedAt: state.publishedAt },
        after: {
          publishedAt: row.publishedAt,
          listings: state.listings,
          verified: state.verified,
        },
      };
    }),
  );

  return { ok: true, publishedAt };
}

/** Take one back out of the index. Always allowed, floors or no floors. */
export async function unpublishEmiratePage(
  actor: Actor,
  emirate: string,
  categoryId: string,
  reason: string,
): Promise<EmiratePageResult> {
  const state = await emirateCategoryState(emirate, categoryId);
  if (!state) return { ok: false, error: "not_found", message: "That trade is not here." };
  if (state.publishedAt === null) {
    return { ok: false, error: "not_published", message: "That page is not published." };
  }

  const key = { emirate: emirate as never, categoryId };
  const subject = await subjectFor(emirate, categoryId);

  await prisma.$transaction(async (tx) =>
    staffMutation({ actor, capability: "taxonomy.write", subject, reason, tx }, async () => {
      await tx.emiratePage.update({
        where: { emirate_categoryId: key },
        data: { publishedAt: null },
      });
      return { result: null, before: { publishedAt: state.publishedAt }, after: { publishedAt: null } };
    }),
  );

  return { ok: true };
}

export interface EmiratePageRow extends EmiratePageState {
  categoryName: string;
  categorySlug: string;
  path: string;
}

/**
 * Every (emirate, sector) pair for the admin screen, whether or not a row
 * exists yet.
 *
 * Eighty-four rows, and the ones nobody has written are the interesting ones —
 * a screen that only listed authored pages would hide exactly the work that
 * needs doing.
 */
export async function emiratePageRows(): Promise<EmiratePageRow[]> {
  const matrix = await emirateMatrix();
  const rows: EmiratePageRow[] = [];

  for (const sector of matrix) {
    for (const emirate of MATRIX_EMIRATES) {
      const state = await emirateCategoryState(emirate, sector.id);
      if (!state) continue;
      rows.push({
        ...state,
        categoryName: sector.name,
        categorySlug: sector.slug,
        path: emiratePagePath(emirate, sector.slug),
      });
    }
  }

  // Closest to publishing first: that is the order somebody working the list
  // wants, rather than alphabetical.
  return rows.sort((a, b) => b.listings - a.listings);
}
