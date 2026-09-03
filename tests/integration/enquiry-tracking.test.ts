import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getTrackingByRef } from "@/lib/db/queries/enquiry-tracking";
import { nudge } from "@/lib/enquiry/nudge";
import { reviseRequirement } from "@/lib/enquiry/revise";
import { recordZeroQuote, sweepZeroQuoteEnquiries, ZERO_QUOTE_TAB } from "@/lib/enquiry/zero-quote";
import { NUDGE_AFTER_MS } from "@/lib/enquiry/tracking";

/**
 * Board 1i's server-side rules.
 *
 * The one the spec insists on proving here rather than by looking at a template
 * is criterion 12: "no recipient can retrieve the buyer's phone, email or
 * company name until `contactReleasedToBusinessId` is set. If that constraint
 * is not enforced, this card is a lie and the card is the thing buyers cite."
 */

const PREFIX = "track-test-";
let buyerId: string;
let otherBuyerId: string;
let categoryId: string;
let businessIds: string[] = [];

async function removeFixtures() {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.zeroResultQuery.deleteMany({ where: { query: { contains: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  const buyers = await prisma.user.findMany({ where: { roles: { has: "buyer" } }, select: { id: true }, take: 2 });
  buyerId = buyers[0]!.id;
  otherBuyerId = buyers[1]?.id ?? buyers[0]!.id;

  const product = await prisma.product.findFirstOrThrow({
    where: { status: { not: "draft" } },
    select: { categoryId: true },
  });
  categoryId = product.categoryId;

  const businesses = await prisma.business.findMany({
    where: { publishedAt: { not: null }, suspendedAt: null, claimStatus: "claimed" },
    select: { id: true },
    take: 3,
  });
  businessIds = businesses.map((b) => b.id);
});

afterAll(removeFixtures);

let seq = 0;
async function makeEnquiry(over: { closesAt?: Date; recipients?: number } = {}) {
  seq += 1;
  const ref = `${PREFIX}${Date.now().toString(36)}${seq}`;
  return prisma.enquiry.create({
    data: {
      ref,
      buyerId,
      requirement: `${PREFIX}chilled water riser, two drops`,
      closesAt: over.closesAt ?? new Date(Date.now() + 7 * 86_400_000),
      lines: { create: [{ description: "Gate valve DN150", qty: 12, sortOrder: 0 }] },
      recipients: {
        create: businessIds.slice(0, over.recipients ?? 2).map((businessId) => ({ businessId })),
      },
    },
    select: { id: true, ref: true },
  });
}

describe("the buyer's contact is unreachable until they accept", () => {
  it("is not selectable by a seller before release — criterion 12", async () => {
    /*
       Proven at the query layer, as the spec demands. `buyerSelectFor` decides
       which columns a seller's read may even name, so this asserts on the shape
       of what the seller-facing query returns rather than on what a template
       chose to print.
    */
    const { buyerSelectFor } = await import("@/lib/db/queries/seller-visibility");
    const before = buyerSelectFor(null, businessIds[0]!);
    expect(before).not.toHaveProperty("phone");
    expect(before).not.toHaveProperty("email");

    // And once released to *that* business, it opens — and only for them.
    const after = buyerSelectFor(businessIds[0]!, businessIds[0]!);
    expect(after).toHaveProperty("phone");
    const someoneElse = buyerSelectFor(businessIds[0]!, businessIds[1]!);
    expect(someoneElse).not.toHaveProperty("phone");
  });
});

describe("reading an enquiry", () => {
  it("returns nothing for a buyer who does not own it", async () => {
    /*
       Criterion 1's other half. An unknown reference and somebody else's
       enquiry are the same answer, which is what stops the page being used to
       find out which references exist.
    */
    const enquiry = await makeEnquiry();
    expect(await getTrackingByRef(otherBuyerId, enquiry.ref)).toBeNull();
    expect(await getTrackingByRef(buyerId, "ENQ-does-not-exist")).toBeNull();
    expect(await getTrackingByRef(buyerId, enquiry.ref)).not.toBeNull();
  });

  it("accepts the id as well as the reference", async () => {
    // Every link already in an inbox carries the id.
    const enquiry = await makeEnquiry();
    expect(await getTrackingByRef(buyerId, enquiry.id)).not.toBeNull();
  });
});

describe("nudge", () => {
  it("refuses before twenty-four hours, and allows it after", async () => {
    const enquiry = await makeEnquiry();
    const tooSoon = await nudge({ buyerId, ref: enquiry.ref, businessId: businessIds[0]!, now: new Date() });
    expect(tooSoon).toMatchObject({ ok: false, error: "too_soon" });

    const later = new Date(Date.now() + NUDGE_AFTER_MS + 1000);
    expect(await nudge({ buyerId, ref: enquiry.ref, businessId: businessIds[0]!, now: later })).toEqual({ ok: true });
  });

  it("is one per recipient, ever", async () => {
    const enquiry = await makeEnquiry();
    const later = new Date(Date.now() + NUDGE_AFTER_MS + 1000);
    await nudge({ buyerId, ref: enquiry.ref, businessId: businessIds[0]!, now: later });
    expect(
      await nudge({ buyerId, ref: enquiry.ref, businessId: businessIds[0]!, now: later }),
    ).toMatchObject({ ok: false, error: "already_nudged" });
  });

  it("cannot be sent on somebody else's enquiry", async () => {
    const enquiry = await makeEnquiry();
    const later = new Date(Date.now() + NUDGE_AFTER_MS + 1000);
    expect(
      await nudge({ buyerId: otherBuyerId, ref: enquiry.ref, businessId: businessIds[0]!, now: later }),
    ).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("revising the requirement", () => {
  it("raises the revision and supersedes quotes without cancelling them", async () => {
    /*
       Criterion 10. "Never silently change a requirement under a seller who has
       already priced it" — and equally, never throw away the only reply the
       buyer has. The quote stays live and acceptable, marked as priced against
       the older text.
    */
    const enquiry = await makeEnquiry();
    const quote = await prisma.quote.create({
      data: {
        ref: `${PREFIX}q${seq}`,
        enquiryId: enquiry.id,
        businessId: businessIds[0]!,
        status: "sent",
        sentAt: new Date(),
      },
      select: { id: true },
    });

    const result = await reviseRequirement({
      buyerId,
      ref: enquiry.ref,
      requirement: `${PREFIX}now four hundred, not forty`,
    });
    expect(result).toMatchObject({ ok: true, revision: 2, superseded: 1 });

    const after = await prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
      select: { status: true, supersededAt: true },
    });
    // Marked, not cancelled: the buyer may still prefer it.
    expect(after.status).toBe("sent");
    expect(after.supersededAt).not.toBeNull();

    const enq = await prisma.enquiry.findUniqueOrThrow({
      where: { id: enquiry.id },
      select: { revision: true, revisedAt: true },
    });
    expect(enq.revision).toBe(2);
    expect(enq.revisedAt).not.toBeNull();
  });

  it("refuses to revise a closed enquiry", async () => {
    // Suppliers can no longer act on it, so a new requirement reaches nobody.
    const enquiry = await makeEnquiry({ closesAt: new Date(Date.now() - 1000) });
    expect(
      await reviseRequirement({ buyerId, ref: enquiry.ref, requirement: `${PREFIX}too late now` }),
    ).toMatchObject({ ok: false, error: "closed" });
  });
});

describe("an enquiry that closed with nothing back", () => {
  it("writes one gap row, and only one — criterion 14", async () => {
    const enquiry = await makeEnquiry({ closesAt: new Date(Date.now() - 1000) });

    expect(await recordZeroQuote(enquiry.id)).toEqual({ written: true });
    // Idempotent: a daily job seeing the same closed enquiry twice must not
    // count one silence as two.
    expect(await recordZeroQuote(enquiry.id)).toEqual({ written: false });

    const row = await prisma.zeroResultQuery.findFirstOrThrow({
      where: { tab: ZERO_QUOTE_TAB, query: { startsWith: enquiry.ref } },
      select: { tab: true, query: true },
    });
    expect(row.query).toContain("Gate valve DN150");
  });

  it("leaves an enquiry that got a quote alone", async () => {
    const enquiry = await makeEnquiry({ closesAt: new Date(Date.now() - 1000) });
    await prisma.quote.create({
      data: {
        ref: `${PREFIX}q-kept-${seq}`,
        enquiryId: enquiry.id,
        businessId: businessIds[0]!,
        status: "sent",
        sentAt: new Date(),
      },
    });
    expect(await recordZeroQuote(enquiry.id)).toEqual({ written: false });
  });

  it("is found by the sweep the daily job runs", async () => {
    await makeEnquiry({ closesAt: new Date(Date.now() - 1000) });
    const result = await sweepZeroQuoteEnquiries();
    expect(result.closed).toBeGreaterThan(0);
  });
});
