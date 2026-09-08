import "server-only";
import { prisma } from "@/lib/db/client";
import { allowance, type Allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { photoPicks, type PhotoPicks } from "@/lib/listing/photos";
import { recentRevisions } from "@/lib/listing/save";
import type { ModeratedField } from "@/lib/listing/service";

/**
 * Board 3b's page, in one read.
 *
 * The shape is driven by the screen's one question — *did that go live, or is
 * someone looking at it* — so held edits arrive resolved to the names the
 * seller typed rather than the ids the queue stores. A chip that says
 * `cm3x9…  IN REVIEW` answers nothing.
 */

const PLAN_SELECT = {
  id: true,
  name: true,
  monthlyPriceAed: true,
  enquiriesPerMonth: true,
  productLimit: true,
  categoryLimit: true,
  locationLimit: true,
  photoLimit: true,
  storageMb: true,
  teamSeats: true,
  rankingMultiplier: true,
  customDomain: true,
  analytics: true,
  csvImport: true,
  sponsoredEligible: true,
  sortOrder: true,
} as const;

export interface HeldEdit {
  id: string;
  field: ModeratedField;
  /** The id stored on the request. */
  value: string;
  /** What to show: a category name, or the raw value for a name or licence. */
  label: string;
  submittedAt: Date;
}

/**
 * A category the seller asked for and a moderator turned down.
 *
 * Board 3b Q3. `decisionReason` has always been written — the moderator types
 * it and the CHECK constraint on decided rows makes it mandatory — and it has
 * never been read on the seller's side. The queue took the words and the chip
 * went back to looking like nothing had happened, so a seller learned that
 * their request had stopped being pending and nothing else. Re-asking blind is
 * the only move that leaves them.
 *
 * One per category, the most recent, and only where the category is neither
 * live nor pending: a newer request supersedes an older refusal, and a category
 * that has since been approved is on the listing where the seller can see it.
 */
export interface RejectedCategory {
  id: string;
  /** The category the request named. */
  categoryId: string;
  /** Its name, resolved here for the same reason `HeldEdit.label` is. */
  label: string;
  /**
   * The moderator's own words. Nullable in the schema because a pending row has
   * none; a rejected row cannot be written without one, so this is only null
   * for a row that predates that constraint.
   */
  reason: string | null;
  decidedAt: Date | null;
}

export interface ListingCategory {
  id: string;
  name: string;
  /** The parent, for `Industrial & MEP → Valves & actuators`. */
  parentName: string | null;
}

export interface Revision {
  id: string;
  field: string;
  itemCount: number | null;
  author: string;
  at: Date;
}

export interface ListingView {
  displayName: string;
  tradeName: string;
  slug: string;
  description: string;
  paymentTerms: string | null;
  establishedYear: number | null;
  teamSize: string | null;
  languages: string[];

  primary: ListingCategory;
  additional: ListingCategory[];
  /** Leaf categories, for both pickers. */
  choices: ListingCategory[];

  held: HeldEdit[];
  /** Turned down, most recent per category. Never counts against the cap. */
  rejected: RejectedCategory[];
  photos: PhotoPicks;
  revisions: Revision[];

  /** Additional categories only — the primary one is not optional. */
  categoryAllowance: Allowance;
  planName: string;
  /** For the preview card. */
  place: string | null;
  ratingOverall: number | null;
  reviewCount: number;
  lastSavedAt: Date | null;
}

export async function getListing(businessId: string): Promise<ListingView | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      displayName: true,
      tradeName: true,
      slug: true,
      description: true,
      paymentTerms: true,
      establishedYear: true,
      teamSize: true,
      languages: true,
      primaryCategoryId: true,
      ratingOverall: true,
      reviewCount: true,
      plan: { select: PLAN_SELECT },
      primaryCategory: { select: { id: true, name: true, parent: { select: { name: true } } } },
      categories: {
        select: { category: { select: { id: true, name: true, parent: { select: { name: true } } } } },
      },
      locations: {
        where: { published: true },
        orderBy: { type: "asc" },
        take: 1,
        select: { area: { select: { name: true } } },
      },
    },
  });
  if (!business) return null;

  const [choices, pending, refused, photos, revisions, allPlans] = await Promise.all([
    /*
       Leaf categories only. A supplier sells gate valves, not "valves and
       fittings", and offering the parent is how a listing ends up filed one
       level too shallow to be found on a filter.
    */
    prisma.category.findMany({
      where: { children: { none: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, parent: { select: { name: true } } },
    }),
    prisma.listingChangeRequest.findMany({
      where: { businessId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true, field: true, afterValue: true, createdAt: true },
    }),
    /*
       Every refusal, newest first, reduced to one per category below.

       Not `take: 1` — that is one row across the whole business, and a seller
       turned down on two categories would read the reason for one of them
       under both. The reduction has to be per category, so the query returns
       the set and the code picks the head of each group.
    */
    prisma.listingChangeRequest.findMany({
      where: { businessId, field: "additional_category", status: "rejected" },
      orderBy: { createdAt: "desc" },
      select: { id: true, afterValue: true, decisionReason: true, decidedAt: true },
    }),
    photoPicks(businessId),
    recentRevisions(businessId),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: PLAN_SELECT }),
  ]);

  const shape = (row: {
    id: string;
    name: string;
    parent: { name: string } | null;
  }): ListingCategory => ({
    id: row.id,
    name: row.name,
    parentName: row.parent?.name ?? null,
  });

  const byId = new Map(choices.map((row) => [row.id, row]));
  const additional = business.categories
    .map((row) => shape(row.category))
    .filter((row) => row.id !== business.primaryCategoryId)
    .sort((a, b) => a.name.localeCompare(b.name));

  /*
     A refusal the seller still needs, and the three ways one stops being that.

     · The category is live now — a later request was approved, so the listing
       already answers the question and a stale refusal beside it would read as
       a contradiction.
     · A request for it is pending — the seller has re-asked, and `IN REVIEW` is
       the newer, truer state of the same chip.
     · An older refusal for a category already refused — only the head of each
       group survives, because a moderator's second set of words replaces the
       first rather than joining it.
  */
  const liveOrPending = new Set<string>([
    ...business.categories.map((row) => row.category.id),
    ...pending.filter((row) => row.field === "additional_category").map((row) => row.afterValue),
  ]);
  const rejected: RejectedCategory[] = [];
  const seen = new Set<string>();
  for (const row of refused) {
    if (seen.has(row.afterValue) || liveOrPending.has(row.afterValue)) continue;
    seen.add(row.afterValue);
    rejected.push({
      id: row.id,
      categoryId: row.afterValue,
      label: byId.get(row.afterValue)?.name ?? row.afterValue,
      reason: row.decisionReason,
      decidedAt: row.decidedAt,
    });
  }

  const plan =
    (business.plan as PlanCaps | null) ??
    allPlans.find((row) => row.monthlyPriceAed === 0) ??
    allPlans[0]!;

  return {
    displayName: business.displayName,
    tradeName: business.tradeName,
    slug: business.slug,
    description: business.description ?? "",
    paymentTerms: business.paymentTerms,
    establishedYear: business.establishedYear,
    teamSize: business.teamSize,
    languages: business.languages,

    primary: shape(business.primaryCategory),
    additional,
    choices: choices.map(shape),

    held: pending.map((row) => ({
      id: row.id,
      field: row.field,
      value: row.afterValue,
      /*
         Resolved here, not in the component. A category request stores an id
         and the chip has to carry the name the seller picked — the server is
         where the map already is, and a client fetching names to label its own
         state is a second source of truth for what was asked.
      */
      label:
        row.field === "primary_category" || row.field === "additional_category"
          ? (byId.get(row.afterValue)?.name ?? row.afterValue)
          : row.afterValue,
      submittedAt: row.createdAt,
    })),
    rejected,
    photos,
    revisions: revisions.map((row) => ({
      id: row.id,
      field: row.field,
      itemCount: row.itemCount,
      // A seat with no name on it is still an author. The seed leaves some
      // blank and "—" is honest where a fabricated name would not be.
      author: row.actor.fullName?.trim() || "—",
      at: row.createdAt,
    })),

    categoryAllowance: allowance(plan, "categories", additional.length),
    planName: plan.name,
    place: business.locations[0]?.area?.name ?? null,
    ratingOverall: business.ratingOverall === null ? null : Number(business.ratingOverall),
    reviewCount: business.reviewCount,
    lastSavedAt: revisions[0]?.createdAt ?? null,
  };
}
