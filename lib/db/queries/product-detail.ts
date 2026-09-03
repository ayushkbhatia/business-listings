import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";
import { STOCK_FRESH_DAYS } from "./storefront-catalogue";
import type { Availability } from "@/lib/db/generated/enums";

/**
 * Board 1g's reads: the comparison table, the other-sellers count, and the
 * questions card.
 *
 * The product itself already had a loader. What did not exist is the thing the
 * board calls "the single most useful thing on the page" — the table of other
 * sellers carrying the same spec — and it is only possible because specs are
 * templated. It is also the reason a seller fills the grey rows, so getting the
 * matching rule right is what makes the rest of the page work.
 */

/** Four rows including the current seller, as the board draws it. */
export const COMPARISON_LIMIT = 4;

/**
 * What counts as "the same spec".
 *
 * Every **filterable** field on the template, matched on value. Filterable is
 * the platform's own answer to "which attributes make two products the same
 * thing" — it is what the catalogue rail filters on, and reusing it means a
 * staff member who adds a filterable field changes what this table considers
 * comparable with no code change. That is board 1e criterion 6 paying off here.
 *
 * Non-filterable fields are deliberately ignored. A datasheet revision or a
 * finish note differing does not make two DN100 PN16 ductile-iron valves
 * different products, and requiring every field to match would empty the table
 * for every product that has one.
 *
 * A field the *current* product has not filled is skipped rather than matched
 * as empty. Otherwise an incomplete listing would only ever match other equally
 * incomplete listings, which inverts the incentive the grey rows exist to
 * create.
 */
function matchableSpec(
  filterableFieldIds: readonly string[],
  specValues: unknown,
): Record<string, unknown> {
  const values = (specValues ?? {}) as Record<string, unknown>;
  const matchable: Record<string, unknown> = {};
  for (const id of filterableFieldIds) {
    const value = values[id];
    if (value === undefined || value === null || value === "") continue;
    matchable[id] = value;
  }
  return matchable;
}

export interface ComparisonRow {
  productId: string;
  productSlug: string;
  businessSlug: string;
  /** Always the display name. A legal name here lands the buyer on another. */
  displayName: string;
  verificationTier: number;
  availability: Availability;
  leadTimeDays: number | null;
  responseTimeMedianMs: number | null;
  /** The non-filterable values the board's `MATERIAL / SEAT` column shows. */
  distinguishing: string[];
  isCurrent: boolean;
}

/**
 * Sellers carrying the same spec, current seller first.
 *
 * Inclusion is the board's list and each clause earns its place: same
 * subcategory, matching values on every filterable field, a verified licence,
 * and a published product. Verified only, because the table is a
 * recommendation — putting an unverified listing in a row headed "same spec"
 * is the platform vouching for a comparison it has not checked.
 *
 * Ordered by lead time then reply time. Never by price, which does not exist,
 * and never by tier — a table that ranked by verification would be selling
 * placement rather than answering the question.
 */
export async function getComparison(
  product: {
    id: string;
    categoryId: string;
    businessId: string;
    specValues: unknown;
    slug: string;
  },
  filterableFieldIds: readonly string[],
  labelFor: (fieldId: string) => string | undefined,
): Promise<ComparisonRow[]> {
  const target = matchableSpec(filterableFieldIds, product.specValues);

  /*
     No spec, no comparison.

     An empty match set means an empty `AND`, which matches every published
     product in the subcategory — so a listing with none of its filterable
     fields filled claimed that eleven unrelated valves were "the same spec".
     That is the opposite of what the table is for, and it would have been the
     loudest on exactly the listings least entitled to it.

     Silence is the honest answer here, and it is also the incentive the grey
     rows exist to create: fill the spec and the table appears.
  */
  if (Object.keys(target).length === 0) return [];

  /*
     The spec match runs in the database rather than over a fetched page.

     Prisma's JSON filtering can express "this key equals this value" per key,
     and `AND`-ing them is the match. Fetching every product in the subcategory
     and filtering in Node would be correct and would also pull a few thousand
     rows for a popular size on a page that renders four.
  */
  const specWhere = Object.entries(target).map(([id, value]) => ({
    specValues: { path: [id], equals: value as never },
  }));

  const candidates = await prisma.product.findMany({
    where: {
      categoryId: product.categoryId,
      status: { not: "draft" },
      business: {
        suspendedAt: null,
        publishedAt: { not: null },
        verificationTier: { gte: VERIFIED_TIER },
      },
      AND: specWhere,
    },
    select: {
      id: true,
      slug: true,
      availability: true,
      leadTimeDays: true,
      specValues: true,
      business: {
        select: {
          slug: true,
          displayName: true,
          verificationTier: true,
          responseTimeMedianMs: true,
        },
      },
    },
    /*
       A generous fetch, then ordered and cut in memory.

       Lead time is a nullable column and reply time lives on the business, so
       the board's "lead time then reply time" is not one `orderBy` the database
       can serve. The candidate set is one subcategory narrowed by an exact spec
       match, which is small by construction.
    */
    take: 60,
  });

  const rows: ComparisonRow[] = candidates.map((candidate) => ({
    productId: candidate.id,
    productSlug: candidate.slug,
    businessSlug: candidate.business.slug,
    displayName: candidate.business.displayName,
    verificationTier: candidate.business.verificationTier,
    availability: candidate.availability,
    leadTimeDays: candidate.leadTimeDays,
    responseTimeMedianMs: candidate.business.responseTimeMedianMs,
    distinguishing: distinguishingValues(
      candidate.specValues,
      filterableFieldIds,
      labelFor,
    ),
    isCurrent: candidate.id === product.id,
  }));

  rows.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    /*
       An unstated lead time sorts last, both directions. It is not zero — a
       seller who has not said sorts behind every seller who has, because the
       column is the buyer's reason for reading the table.
    */
    const leadA = a.leadTimeDays ?? Number.POSITIVE_INFINITY;
    const leadB = b.leadTimeDays ?? Number.POSITIVE_INFINITY;
    if (leadA !== leadB) return leadA - leadB;
    const replyA = a.responseTimeMedianMs ?? Number.POSITIVE_INFINITY;
    const replyB = b.responseTimeMedianMs ?? Number.POSITIVE_INFINITY;
    return replyA - replyB;
  });

  return rows.slice(0, COMPARISON_LIMIT);
}

/**
 * The values that tell two spec-matched products apart.
 *
 * Everything matched is identical by construction, so the useful column is the
 * fields that were *not* part of the match — material, seat, finish. Two rows
 * reading the same in every column would make the table look broken while
 * being perfectly correct.
 */
function distinguishingValues(
  specValues: unknown,
  filterableFieldIds: readonly string[],
  labelFor: (fieldId: string) => string | undefined,
): string[] {
  const values = (specValues ?? {}) as Record<string, unknown>;
  const filterable = new Set(filterableFieldIds);
  const out: string[] = [];
  for (const [id, value] of Object.entries(values)) {
    if (filterable.has(id)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (!labelFor(id)) continue;
    out.push(String(value));
    if (out.length === 2) break;
  }
  return out;
}

/**
 * How many other verified sellers stock this spec.
 *
 * Counted rather than derived from the comparison rows, because the table is
 * capped at four and the card states the real number. "4 other verified sellers
 * stock this size in Dubai" is a fact a buyer acts on; the same sentence
 * computed from a truncated list would understate it and read as a bug the day
 * a fifth seller appeared.
 */
export async function countOtherSellers(
  product: { id: string; categoryId: string; specValues: unknown },
  filterableFieldIds: readonly string[],
): Promise<number> {
  const target = matchableSpec(filterableFieldIds, product.specValues);
  // Same rule as the table: an empty match is not a match. See `getComparison`.
  if (Object.keys(target).length === 0) return 0;

  const specWhere = Object.entries(target).map(([id, value]) => ({
    specValues: { path: [id], equals: value as never },
  }));

  const total = await prisma.product.count({
    where: {
      id: { not: product.id },
      categoryId: product.categoryId,
      status: { not: "draft" },
      business: {
        suspendedAt: null,
        publishedAt: { not: null },
        verificationTier: { gte: VERIFIED_TIER },
      },
      AND: specWhere,
    },
  });
  return total;
}

export interface PublicQuestion {
  id: string;
  body: string;
  answer: string;
  answeredAt: Date;
}

/**
 * The answered questions for one product, newest first, and how many there are.
 *
 * Only answered and unremoved. An unanswered question is a lead for the seller,
 * not content for the page: a card full of unanswered questions reads as a
 * supplier who ignores people, and that is a claim we would be making on their
 * behalf out of an absence.
 */
export async function getQuestions(
  productId: string,
  take = 1,
): Promise<{ shown: PublicQuestion[]; answered: number }> {
  const where = {
    productId,
    removedAt: null,
    answeredAt: { not: null },
  } as const;

  const [rows, answered] = await Promise.all([
    prisma.productQuestion.findMany({
      where,
      orderBy: { answeredAt: "desc" },
      take,
      select: { id: true, body: true, answer: true, answeredAt: true },
    }),
    prisma.productQuestion.count({ where }),
  ]);

  return {
    // The CHECK guarantees the pairing, so the non-null assertions are the
    // database's promise rather than an assumption.
    shown: rows.map((row) => ({
      id: row.id,
      body: row.body,
      answer: row.answer!,
      answeredAt: row.answeredAt!,
    })),
    answered,
  };
}

export { STOCK_FRESH_DAYS };
