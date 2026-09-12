import "server-only";
import { prisma } from "@/lib/db/client";
import { profileStrength, type ProfileFacts } from "./profile-strength";
import {
  specCompleteness,
  type ProductSpecs,
  type SpecFieldRule,
} from "./spec-completeness";

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
  /** Businesses whose `specCompleteness` moved. */
  specUpdated: number;
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
      specCompleteness: true,
      /*
         Board `8a-s`. Which weight table this listing is measured against, and
         the facts the services half of it reads. All zero for the 123 live
         businesses, every one of which is `unset` and therefore measured
         exactly as it was before the fork.
      */
      sellsKind: true,
      verifiedAt: true,
      sectorsServed: true,
      deliveryModes: true,
      categories: { select: { categoryId: true } },
      locations: { select: { hours: true } },
      _count: {
        select: {
          team: true,
          products: true,
          services: { where: { status: "live" } },
          serviceCoverage: true,
          documents: { where: { kind: "certificate" } },
        },
      },
    },
  });

  // Two whole-table reads rather than two queries per business. At 41,000
  // listings this is the difference between a job and an outage.
  const [productRows, mediaRows, fieldRows] = await Promise.all([
    prisma.product.findMany({
      select: {
        businessId: true,
        specValues: true,
        category: { select: { defaultTemplateId: true } },
      },
    }),
    prisma.media.findMany({
      where: { reviewId: null },
      // Board 3i backfilled `business_id` onto every product photograph, so the
      // owner is on the row and the hop through `product` is gone.
      select: { kind: true, businessId: true },
    }),
    /*
     * The rules every template imposes, read once. `requiredFrom` is what makes
     * a grace period real: a field added to a live template with a deadline in
     * the future does not count against products filed before it.
     */
    prisma.specField.findMany({
      select: {
        id: true,
        templateId: true,
        key: true,
        required: true,
        isFilterable: true,
        requiredFrom: true,
      },
    }),
  ]);

  const rulesByTemplate = new Map<string, SpecFieldRule[]>();
  for (const field of fieldRows) {
    const list = rulesByTemplate.get(field.templateId) ?? [];
    list.push({
      id: field.id,
      key: field.key,
      required: field.required,
      isFilterable: field.isFilterable,
      requiredFrom: field.requiredFrom,
    });
    rulesByTemplate.set(field.templateId, list);
  }

  /*
   * Products per business, carrying the template their category points at.
   * `specCompleteness` was `0.4 + rnd() * 0.6` in the seed until now, and
   * `lib/search/ranking.ts` weights it at 12 — so search order has been partly
   * random since handoff 0. This is the column, measured.
   */
  const specsByBusiness = new Map<string, ProductSpecs[]>();
  for (const row of productRows) {
    const list = specsByBusiness.get(row.businessId) ?? [];
    list.push({
      templateId: row.category?.defaultTemplateId ?? null,
      values: row.specValues as Record<string, unknown> | null,
    });
    specsByBusiness.set(row.businessId, list);
  }

  // Photos per business, counting the ones hanging off products as well.
  const photoCounts = new Map<string, number>();
  const logos = new Set<string>();
  const covers = new Set<string>();
  for (const media of mediaRows) {
    const owner = media.businessId;
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
  let specUpdated = 0;
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

      credentials: business._count.documents,
      // `verifiedAt` rather than the tier: the tier is a ladder and this is the
      // one rung that means "checked against the issuing authority".
      licenceVerified: business.verifiedAt !== null,
      servicesLive: business._count.services,
      sectors: business.sectorsServed.length,
      deliveryModes: business.deliveryModes.length,
      coverageAreas: business._count.serviceCoverage,
    };

    const score = profileStrength(facts, business.sellsKind);
    const completeness = specCompleteness(
      specsByBusiness.get(business.id) ?? [],
      rulesByTemplate,
      now,
    );

    const strengthMoved = score !== business.profileStrength;
    const completenessMoved =
      completeness === null
        ? business.specCompleteness !== null
        : business.specCompleteness === null ||
          Math.abs(Number(business.specCompleteness) - completeness) > 0.001;

    if (!strengthMoved && !completenessMoved) continue;

    await prisma.business.update({
      where: { id: business.id },
      data: { profileStrength: score, specCompleteness: completeness, derivedAt: now },
    });
    if (strengthMoved) updated += 1;
    if (completenessMoved) specUpdated += 1;
  }

  return { businessesConsidered: businesses.length, updated, specUpdated, ranAt: now };
}

/** `hours` is Json and defaults to `{}`, so presence is not the same as filled in. */
function hasHours(hours: unknown): boolean {
  return typeof hours === "object" && hours !== null && Object.keys(hours).length > 0;
}
