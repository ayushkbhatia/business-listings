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

  const [choices, pending, photos, revisions, allPlans] = await Promise.all([
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
