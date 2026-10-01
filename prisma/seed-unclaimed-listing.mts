import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board 10g — the unclaimed composition of `/b/:slug`, on listings that say
 * what the board says.
 *
 * The seed's own unclaimed listings come out of the main generator with no
 * licensed activity, a warehouse address and a telephone on every one, so not
 * one of them shows the drawn record: an activity the register states, an area
 * and nothing else, a telephone *Not on record*. And their trades decide by
 * chance whether 13d's suggestion query finds anybody. These two are drawn on
 * purpose instead:
 *
 *   Deira Cooling House   current licence, activity on record, no telephone.
 *                         HVAC, where Dubai has claimed, licence-verified
 *                         suppliers with measured replies — none of them in
 *                         Deira — so the panel fills by widening to the
 *                         emirate, which is the board's own case.
 *   Naif Ventilation      the licence lapsed twenty days ago, a telephone on
 *   Trading               record and no activity: *Expired on record*, no
 *                         claim controls, `noindex` (B4, Q4).
 *
 * New businesses, PRNG-free, so no slug another spec pins moves. They sit in
 * Deira, where neither HVAC landing page counts them, and after the detector
 * sweep, so no report is filed against either.
 */

type Db = PrismaClient;

const DAY = 86_400_000;

/** January's import run, which the record card's kicker names. */
const IMPORTED = new Date(Date.UTC(2026, 0, 14, 8, 0, 0));

export const UNCLAIMED_FIXTURES = {
  current: "deira-cooling-house-llc",
  lapsed: "naif-ventilation-trading-llc",
} as const;

export async function seedUnclaimedListing(db: Db, now: Date): Promise<void> {
  console.log("→ unclaimed listings, for board 10g");

  const [category, deira] = await Promise.all([
    db.category.findUniqueOrThrow({ where: { slug: "hvac-and-ventilation" }, select: { id: true } }),
    db.area.findUniqueOrThrow({ where: { slug: "deira" }, select: { id: true } }),
  ]);

  const fixtures = [
    {
      slug: UNCLAIMED_FIXTURES.current,
      tradeName: "Deira Cooling House LLC",
      displayName: "Deira Cooling House",
      licenceNumber: "DED-118904",
      licenceExpiry: new Date(now.getTime() + 300 * DAY),
      licenceActivity: "Trading in air-conditioning & ventilation equipment",
      addressLine: "Deira, Naif",
      phone: null,
    },
    {
      slug: UNCLAIMED_FIXTURES.lapsed,
      tradeName: "Naif Ventilation Trading LLC",
      displayName: "Naif Ventilation Trading",
      licenceNumber: "DED-118911",
      licenceExpiry: new Date(now.getTime() - 20 * DAY),
      licenceActivity: null,
      addressLine: "Naif Road, Deira",
      phone: "+97142261180",
    },
  ];

  for (const fixture of fixtures) {
    await db.business.create({
      data: {
        slug: fixture.slug,
        tradeName: fixture.tradeName,
        displayName: fixture.displayName,
        licenceNumber: fixture.licenceNumber,
        licenceAuthority: "DED",
        licenceExpiry: fixture.licenceExpiry,
        licenceActivity: fixture.licenceActivity,
        primaryCategoryId: category.id,
        claimStatus: "unclaimed",
        source: "licence_import",
        // Nothing has been checked. Tier 0 says so, as the importer writes it.
        verificationTier: 0,
        createdAt: IMPORTED,
        publishedAt: IMPORTED,
        locations: {
          create: {
            type: "head_office",
            emirate: "dubai",
            areaId: deira.id,
            addressLine: fixture.addressLine,
            phone: fixture.phone,
            phoneVerified: false,
            published: true,
            publishedAt: IMPORTED,
          },
        },
      },
    });
  }
}
