import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { attributionReport } from "@/lib/campaign/report";
import { createEnquiry } from "@/lib/enquiry/service";
import type { Attribution } from "@/lib/campaign/attribution";

/**
 * Criterion 9 — "campaign pages preserve UTM through to the enquiry and
 * attribute it in admin".
 *
 * Split deliberately. `lib/campaign/attribution.test.ts` covers the parsing and
 * the first-touch rule without a request; `tests/e2e/campaign.spec.ts` covers
 * the cookie surviving a navigation. This covers the part in the middle: what
 * the service does with attribution it is handed, and what the console then
 * reports.
 */

const PREFIX = "attr-test-";
let buyerId: string;
let categoryId: string;
let campaignId: string;
const CAMPAIGN_SLUG = `${PREFIX}winter`;
const madeEnquiries: string[] = [];

/**
 * Take away the enquiries this file sent.
 *
 * By requirement text, not by ref: `createEnquiry` mints its own `ENQ-nnnn`, so
 * a prefix filter matched nothing and this file left four real enquiries in the
 * shared valves category on every run. They count toward the free-plan monthly
 * cap, so `enquiry-fanout.test.ts` started finding four candidates where it
 * expects five — a failure in a file that had not changed.
 */
const REQUIREMENT = "Isolation valves for a chilled water riser, DN100, PN16.";

async function removeFixtures() {
  await prisma.enquiry.deleteMany({ where: { requirement: REQUIREMENT } });
  await prisma.campaign.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();

  buyerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" }, isProvisional: false },
      select: { id: true },
    })
  ).id;
  categoryId = (
    await prisma.category.findUniqueOrThrow({
      where: { slug: "valves-and-fittings" },
      select: { id: true },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: {
        slug: CAMPAIGN_SLUG,
        headline: "A campaign for the test to attribute to",
        publishedAt: new Date(),
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

async function send(attribution: Attribution | null) {
  const result = await createEnquiry({
    buyerId,
    requirement: REQUIREMENT,
    lines: [{ description: "Gate valve DN100", qty: 12 }],
    categoryId,
    emirate: "dubai",
    fanoutTo: 3,
    attribution,
  });
  if (result.ok) madeEnquiries.push(result.enquiryId);
  return result;
}

describe("what the service does with attribution", () => {
  it("puts it on the enquiry row", async () => {
    const result = await send({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "hvac-q3",
      campaignSlug: CAMPAIGN_SLUG,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: { utmSource: true, utmMedium: true, utmCampaign: true, campaignId: true },
    });
    expect(row).toEqual({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "hvac-q3",
      campaignId,
    });
  }, 120_000);

  it("leaves the columns null for a buyer who arrived untagged", async () => {
    // Direct is a real answer. A default of "organic" would be a guess written
    // into a column somebody later reports on as though it were measured.
    const result = await send(null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: { utmSource: true, utmMedium: true, utmCampaign: true, campaignId: true },
    });
    expect(row).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      campaignId: null,
    });
  }, 120_000);

  it("stores a partial tag rather than refusing it", async () => {
    /*
       Half the links in the world carry a source and nothing else. Dropping
       those would understate every campaign that ever shipped a short link.
    */
    const result = await send({
      utmSource: "newsletter",
      utmMedium: null,
      utmCampaign: null,
      campaignSlug: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: { utmSource: true, utmMedium: true },
    });
    expect(row.utmSource).toBe("newsletter");
    expect(row.utmMedium).toBeNull();
  }, 120_000);

  it("survives the campaign row being deleted", async () => {
    /*
       `onDelete: SetNull`. A campaign that is taken down should not take the
       enquiries it won with it, and the UTM values on the row still say where
       they came from.
    */
    const result = await send({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: `${PREFIX}doomed`,
      campaignSlug: CAMPAIGN_SLUG,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await prisma.campaign.delete({ where: { id: campaignId } });

    const row = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: { campaignId: true, utmCampaign: true },
    });
    expect(row.campaignId).toBeNull();
    expect(row.utmCampaign).toBe(`${PREFIX}doomed`);
  }, 120_000);
});

describe("what the console reports", () => {
  it("groups by campaign, source and medium and counts them", async () => {
    const report = await attributionReport();
    const row = report.rows.find(
      (candidate) => candidate.campaign === "hvac-q3" && candidate.source === "google",
    );
    expect(row, "the attributed enquiry is not in the report").toBeDefined();
    expect(row?.enquiries).toBeGreaterThanOrEqual(1);
    expect(row?.first).toBeInstanceOf(Date);
  }, 120_000);

  it("counts untagged enquiries as a row rather than leaving them out", async () => {
    /*
       A report showing only the attributed ones makes every campaign look like
       the whole of demand, which is the way this number is usually misread.
    */
    const report = await attributionReport();
    const direct = report.rows.find(
      (row) => row.campaign === null && row.source === null && row.medium === null,
    );
    expect(direct, "untagged enquiries are missing from the report").toBeDefined();
    expect(report.attributed).toBeLessThan(report.total);
  }, 120_000);

  it("attributes no more than were sent", async () => {
    const report = await attributionReport();
    const summed = report.rows.reduce((total, row) => total + row.enquiries, 0);
    expect(summed).toBe(report.total);
  }, 120_000);
});
