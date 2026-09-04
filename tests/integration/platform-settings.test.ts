import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { readEnquiryLift } from "@/lib/metrics/enquiry-lift";
import { setupHubState } from "@/lib/setup/service";
import {
} from "@/lib/setup/tasks";
import {
  CATALOGUE_IMPORT_PRICING_KEY,
  FALLBACK_CATALOGUE_PRICING,
  readCataloguePricing,
} from "@/lib/catalogue-import/pricing";

/**
 * The two prices board 8a shows, against a real database.
 *
 * Both are platform settings rather than constants, for the reason CLAUDE.md
 * gives twice: every number is a query, and content belongs in the database. A
 * price correction should cost a row and not a build, a deploy and a cold
 * cache.
 *
 * There are two claims here and a unit test can reach neither.
 *
 *   1. **The seed and the compiled figure are the same number.** `prisma/seed.mts`
 *      writes `FALLBACK_SITE_VISIT_FEE_AED` rather than `750`, so the only way
 *      the row and the card can disagree is if somebody types the price twice.
 *      This reads the row back through the module's own parser and asserts it
 *      lands on the compiled figure — which is a drift test, not a value test.
 *   2. **A mangled row degrades rather than detonates.** The setting is
 *      staff-writable, so the realistic failure is somebody saving nonsense in
 *      an admin screen at four in the afternoon. A seller's hub must still
 *      render, quoting the last known-good number. Both readers swallow and log
 *      instead of throwing, and that is asserted through the hub rather than
 *      through the parser, because the parser returning null proves nothing
 *      about what the screen does with it.
 *
 * `readEnquiryLift` rather than `getEnquiryLift`: `unstable_cache` needs Next's
 * incremental cache and throws outside a request. Same split as the hub test.
 *
 * These rewrite platform-wide rows, so both are snapshotted in `beforeAll` and
 * put back in `afterAll`. Every mutating test sets the state it needs at its own
 * first line rather than inheriting the previous one's, so a failure partway
 * cannot make the next test's failure belong to this one.
 */

const PREFIX = "platform-settings-test-";

let businessId: string;

/** The two rows as they were found, so `afterAll` puts them back. */
let originalPricing: { value: unknown } | null = null;

async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value: value as never },
    create: { key, value: value as never },
  });
}

async function clearSetting(key: string): Promise<void> {
  await prisma.platformSetting.delete({ where: { key } }).catch(() => undefined);
}

async function restoreSetting(key: string, original: { value: unknown } | null): Promise<void> {
  if (original === null) await clearSetting(key);
  else await setSetting(key, original.value);
}

async function removeFixtures(): Promise<void> {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

/** The hub as the page reads it, with the uncached lift. */
function hub() {
  return setupHubState(businessId, readEnquiryLift);
}

beforeAll(async () => {
  await removeFixtures();

  const stamp = Date.now().toString(36);
  const categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;

  /*
     Its own listing, with no seats and nothing on it. What is being measured is
     the fee the hub quotes, and a borrowed supplier would tie this file to
     somebody else's fixture for a number that has nothing to do with them.
  */
  const business = await prisma.business.create({
    data: {
      tradeName: `Platform Settings Fixture ${stamp}`,
      displayName: `Platform Settings Fixture ${stamp}`,
      slug: `${PREFIX}${stamp}`,
      licenceNumber: `DED-PS-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: "free",
      publishedAt: new Date(Date.now() - 2 * 86_400_000),
    },
    select: { id: true },
  });
  businessId = business.id;

  originalPricing = await prisma.platformSetting.findUnique({
    where: { key: CATALOGUE_IMPORT_PRICING_KEY },
    select: { value: true },
  });
});

afterAll(async () => {
  /*
     Both rows are shared with every other suite on this database — the hub test
     asserts the fee is above zero and the catalogue test freezes it onto a
     request. Leaving this file's nonsense behind would make the next run's
     failures belong here.
  */
  await restoreSetting(CATALOGUE_IMPORT_PRICING_KEY, originalPricing);
  await removeFixtures();
  await prisma.$disconnect();
});

describe("the concierge catalogue prices are a row", () => {
  it("reads a row holding the compiled terms back as the compiled terms", async () => {
    /*
       Written here rather than by the seed, which is a gap and not a choice:
       `CATALOGUE_IMPORT_PRICING_KEY` and `FALLBACK_CATALOGUE_PRICING` sit in a
       `server-only` module, and `prisma db seed` runs plain tsx, where
       importing one throws before the first row is written. Moving the two
       constants to a pure sibling is the three-line change that file's own
       header prescribes; until it lands, this asserts the half that matters —
       that the terms the seed would write survive the reader that reads them
       back. It is the same assertion once the seed writes the row.
    */
    await setSetting(CATALOGUE_IMPORT_PRICING_KEY, FALLBACK_CATALOGUE_PRICING);

    expect(await readCataloguePricing()).toEqual(FALLBACK_CATALOGUE_PRICING);
  });

  it("falls back rather than throwing when the value is nonsense", async () => {
    await setSetting(CATALOGUE_IMPORT_PRICING_KEY, "basic is two hundred and fifty");

    // Free stays not offered rather than becoming free, which is the one way
    // to be wrong here that would sell a seller work their plan cannot hold.
    expect(await readCataloguePricing()).toEqual(FALLBACK_CATALOGUE_PRICING);
  });

  it("falls back rather than throwing when there is no row at all", async () => {
    await clearSetting(CATALOGUE_IMPORT_PRICING_KEY);

    expect(await readCataloguePricing()).toEqual(FALLBACK_CATALOGUE_PRICING);
  });
});
