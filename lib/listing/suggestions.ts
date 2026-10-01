import "server-only";
import type { Emirate } from "@/lib/db/generated/enums";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { STOREFRONT_TAB_COUNTS } from "@/lib/db/queries/business";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Claimed suppliers to send a buyer to, from a listing that cannot help them.
 *
 * Board 13d §4's query, which board 10g `B7` takes unchanged — so it lives here
 * rather than in either page, and 13d's not-found page will import it rather
 * than restate it. Its quality is the whole point of both panels:
 *
 *   category      the listing's primary category, nothing wider
 *   verification  licence-verified only, claimed only
 *   reply         measured, and within a day
 *   exclude       the listing, and anything on its licence number
 *   area          its area, widening to its emirate, then the UAE, only while
 *                 fewer than three have been found
 *   order         fastest median reply first, across whatever was found
 *   cap           three; one is a valid panel and none removes it
 *   sponsored     never
 *
 * **It never reads a placement.** No join to `PlacementSlot` or `ListingBoost`
 * and no plan multiplier in the order — both pages print "not paid placements",
 * and on these two surfaces a paid row would be indistinguishable from an
 * editorial one because the buyer has no result of their own to compare it
 * with. A supplier who buys placement elsewhere can still appear, on the same
 * terms as everybody else, which is why the guarantee is about the query and
 * the test asserts on its arguments rather than on who comes back.
 *
 * The widening chooses *who*, the reply time chooses the order. On the board,
 * a Deira listing's suggestions run Jebel Ali (two hours) before Deira (three)
 * because the Deira firm alone did not fill the panel, the emirate was asked,
 * and the faster reply leads.
 *
 * This replaced `getSimilarClaimedBusinesses`, which widened by parent
 * category, ordered by tier and a stored review count, asked nothing about
 * replies and kept a firm on the subject's own licence number in the running.
 */

export const SUGGESTION_CAP = 3;

/** 13d §4: "median response hours is not null and ≤ 24". */
export const SUGGESTION_REPLY_CEILING_MS = 24 * 60 * 60 * 1000;

export interface SuggestionSubject {
  businessId: string;
  licenceNumber: string;
  primaryCategoryId: string;
  /** The listing's head-office area. Null skips the first ring. */
  areaId: string | null;
  emirate: Emirate | null;
}

export type SuggestionRing = "area" | "emirate" | "uae";

const SUGGESTION_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  verificationTier: true,
  verifiedAt: true,
  responseTimeMedianMs: true,
  primaryCategory: { select: { code: true } },
  /*
     Up to five published locations, so the row can name the branch in the
     subject's own area or emirate rather than whichever sorts first: a firm
     found through its Deira branch, labelled with its Jebel Ali head office,
     reads as the widening having happened when it did not.
  */
  locations: {
    where: { published: true },
    select: { areaId: true, emirate: true, area: { select: { name: true } } },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 5,
  },
  _count: {
    select: {
      products: STOREFRONT_TAB_COUNTS.products,
      services: STOREFRONT_TAB_COUNTS.services,
    },
  },
} satisfies Prisma.BusinessSelect;

/**
 * One ring's `findMany` arguments. Exported so a test can assert on what the
 * query asks for — the sponsored guarantee is a property of these arguments.
 */
export function suggestionQuery(
  subject: SuggestionSubject,
  ring: SuggestionRing,
  found: readonly string[],
  take: number,
) {
  const place: Prisma.BusinessWhereInput =
    ring === "area" && subject.areaId
      ? { locations: { some: { areaId: subject.areaId, published: true } } }
      : ring === "emirate" && subject.emirate
        ? { locations: { some: { emirate: subject.emirate, published: true } } }
        : {};

  return {
    where: {
      suspendedAt: null,
      publishedAt: { not: null },
      claimStatus: "claimed",
      verificationTier: { gte: VERIFIED_TIER },
      responseTimeMedianMs: { not: null, lte: SUGGESTION_REPLY_CEILING_MS },
      primaryCategoryId: subject.primaryCategoryId,
      licenceNumber: { not: subject.licenceNumber },
      id: { notIn: [subject.businessId, ...found] },
      ...place,
    },
    select: SUGGESTION_SELECT,
    // `id` last: two firms with the same median would otherwise swap places
    // between renders of one page.
    orderBy: [{ responseTimeMedianMs: "asc" }, { id: "asc" }],
    take,
  } satisfies Prisma.BusinessFindManyArgs;
}

export type Suggestion = Prisma.BusinessGetPayload<{ select: typeof SUGGESTION_SELECT }>;

function byReply(a: Suggestion, b: Suggestion): number {
  const reply = (a.responseTimeMedianMs ?? Infinity) - (b.responseTimeMedianMs ?? Infinity);
  return reply !== 0 ? reply : a.id.localeCompare(b.id);
}

export async function nearestVerifiedInTrade(
  subject: SuggestionSubject,
  cap: number = SUGGESTION_CAP,
): Promise<Suggestion[]> {
  const rings: SuggestionRing[] = [
    ...(subject.areaId ? (["area"] as const) : []),
    ...(subject.emirate ? (["emirate"] as const) : []),
    "uae",
  ];

  const found: Suggestion[] = [];
  for (const ring of rings) {
    if (found.length >= cap) break;
    const rows = await prisma.business.findMany(
      suggestionQuery(
        subject,
        ring,
        found.map((row) => row.id),
        cap - found.length,
      ),
    );
    found.push(...rows);
  }
  return found.sort(byReply);
}

/**
 * The location a suggestion row names: the branch in the subject's area, else
 * one in its emirate, else the first published one.
 */
export function suggestionPlace(
  suggestion: Suggestion,
  subject: Pick<SuggestionSubject, "areaId" | "emirate">,
): Suggestion["locations"][number] | null {
  return (
    suggestion.locations.find((location) => subject.areaId !== null && location.areaId === subject.areaId) ??
    suggestion.locations.find((location) => subject.emirate !== null && location.emirate === subject.emirate) ??
    suggestion.locations[0] ??
    null
  );
}
