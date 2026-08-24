import "server-only";
import { prisma } from "@/lib/db/client";
import { profileStrength, type ProfileFacts } from "./profile-strength";

/**
 * The profile-strength measurement job.
 *
 * Reads only rows the seller filled in by doing the work — descriptions,
 * photos, products, locations, seats — and writes `Business.profileStrength`.
 * There is no API path to that column and no form field for it, which is what
 * criterion 11 asks for. Before this it was a seeded random number.
 *
 * Runs beside `measureResponseTimes` on the same schedule and in the same
 * request. Both are idempotent, both read facts and write one column, and
 * keeping them together means there is one place a derived figure comes from.
 */

export interface StrengthResult {
  businessesConsidered: number;
  updated: number;
  ranAt: Date;
}

export async function measureProfileStrength(now: Date = new Date()): Promise<StrengthResult> {
  /*
   * Unclaimed listings are measured too, and score low, which is correct: an
   * imported licence record with no photographs and no catalogue is a weak
   * profile, and that is the number the claim funnel argues from.
   */
  const businesses = await prisma.business.findMany({
    where: { suspendedAt: null },
    select: {
      id: true,
      description: true,
      establishedYear: true,
      teamSize: true,
      languages: true,
      profileStrength: true,
      categories: { select: { categoryId: true } },
      locations: { select: { hours: true } },
      _count: { select: { team: true, products: true } },
    },
  });

  // Two whole-table reads rather than two queries per business. At 41,000
  // listings this is the difference between a job and an outage.
  const [productRows, mediaRows] = await Promise.all([
    prisma.product.findMany({ select: { businessId: true, specValues: true } }),
    prisma.media.findMany({
      where: { reviewId: null },
      select: { kind: true, businessId: true, product: { select: { businessId: true } } },
    }),
  ]);

  // Photos per business, counting the ones hanging off products as well.
  const photoCounts = new Map<string, number>();
  const logos = new Set<string>();
  const covers = new Set<string>();
  for (const media of mediaRows) {
    const owner = media.businessId ?? media.product?.businessId;
    if (!owner) continue;
    photoCounts.set(owner, (photoCounts.get(owner) ?? 0) + 1);
    if (media.kind === "logo") logos.add(owner);
    if (media.kind === "cover") covers.add(owner);
  }

  // A product counts as filterable when it has any spec value at all. The
  // per-template check belongs with the catalogue loop in step 2; counting an
  // empty spec object as complete would be the wrong direction to be wrong in.
  const withSpecs = new Map<string, number>();
  for (const product of productRows) {
    const values = product.specValues as Record<string, unknown> | null;
    if (!values || Object.keys(values).length === 0) continue;
    withSpecs.set(product.businessId, (withSpecs.get(product.businessId) ?? 0) + 1);
  }

  let updated = 0;
  for (const business of businesses) {
    const facts: ProfileFacts = {
      hasDescription: (business.description ?? "").trim().length > 0,
      hasLogo: logos.has(business.id),
      hasCover: covers.has(business.id),
      additionalCategories: business.categories.length,
      hasEstablishedYear: business.establishedYear !== null,
      hasTeamSize: business.teamSize !== null,
      languages: business.languages.length,
      locations: business.locations.length,
      locationsWithHours: business.locations.filter((l) => hasHours(l.hours)).length,
      products: business._count.products,
      productsWithFilterableSpecs: withSpecs.get(business.id) ?? 0,
      photos: photoCounts.get(business.id) ?? 0,
      teamSeats: business._count.team,
    };

    const score = profileStrength(facts);
    if (score === business.profileStrength) continue;

    await prisma.business.update({
      where: { id: business.id },
      data: { profileStrength: score, derivedAt: now },
    });
    updated += 1;
  }

  return { businessesConsidered: businesses.length, updated, ranAt: now };
}

/** `hours` is Json and defaults to `{}`, so presence is not the same as filled in. */
function hasHours(hours: unknown): boolean {
  return typeof hours === "object" && hours !== null && Object.keys(hours).length > 0;
}
