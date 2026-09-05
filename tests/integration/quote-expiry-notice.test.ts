import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { EXPIRY_NOTICE_DAYS, sweepExpiringQuotes } from "@/lib/quotes/expiry-job";

/**
 * Board 7e §2's added row — "3k ships the expiry window and had nothing
 * notifying it."
 *
 * Board 3k drew an `Expiring soon` tab and an extend action, and the only way a
 * seller met either was by opening the screen. Which means the quotes that
 * lapsed unnoticed belonged to the sellers who were busy.
 */

const PREFIX = "7E-EXPIRY-FIXTURE";

let businessId: string;
let buyerId: string;
/* The seeded matrix, put back afterwards. A suite that left a real supplier's
   routing rewritten is somebody else's red test tomorrow. */
let originalRouting: unknown;
let originalQuiet: boolean;
const enquiries: string[] = [];

beforeAll(async () => {
  businessId = (
    await prisma.business.findFirstOrThrow({
      where: {
        claimStatus: "claimed",
        team: { some: { roles: { has: "seller_owner" } } },
        notificationPreference: { isNot: null },
      },
      orderBy: { slug: "asc" },
      select: { id: true },
    })
  ).id;

  buyerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;

  const preference = await prisma.notificationPreference.findUniqueOrThrow({
    where: { businessId },
    select: { routing: true, quietHoursEnabled: true },
  });
  originalRouting = preference.routing;
  originalQuiet = preference.quietHoursEnabled;

  /*
     Routed on, and quiet hours out of the way. `notify` writes nothing at all
     for an event the seller has switched off, which would make every assertion
     below pass for the wrong reason.
  */
  await prisma.notificationPreference.update({
    where: { businessId },
    data: { routing: { quote_expiring: ["in_app"] }, quietHoursEnabled: false },
  });
});

afterEach(async () => {
  const ids = enquiries.splice(0);
  if (ids.length > 0) {
    await prisma.notificationDelivery.deleteMany({ where: { enquiryId: { in: ids } } });
    await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });
  }
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.notificationPreference.update({
    where: { businessId },
    data: { routing: originalRouting as never, quietHoursEnabled: originalQuiet },
  });
  await prisma.$disconnect();
});

/** A sent quote whose window closes in `days`. */
async function quote(label: string, days: number): Promise<string> {
  const now = new Date();
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}`,
      buyerId,
      requirement: `${PREFIX} ${label} — gate valves for a riser.`,
      closesAt: new Date(now.getTime() + 30 * 86_400_000),
      lines: { create: [{ description: `${PREFIX} valve`, qty: 4, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  enquiries.push(enquiry.id);
  await prisma.enquiryRecipient.create({ data: { enquiryId: enquiry.id, businessId } });
  await prisma.quote.create({
    data: {
      ref: `QT-${PREFIX}-${label}`,
      enquiryId: enquiry.id,
      businessId,
      status: "sent",
      revision: 1,
      sentAt: now,
      expiresAt: new Date(now.getTime() + days * 86_400_000),
    },
  });
  return enquiry.id;
}

describe("telling a seller a quote is about to lapse", () => {
  it("notifies inside the window and not outside it", async () => {
    /*
       Two days, not board 3k's seven. The tab is a list to work down; this is
       an interruption, and a seller interrupted about a deadline five days out
       stops reading the ones that are tomorrow.
    */
    const soon = await quote("SOON", EXPIRY_NOTICE_DAYS - 1);
    const later = await quote("LATER", EXPIRY_NOTICE_DAYS + 5);

    const result = await sweepExpiringQuotes();
    expect(result.notified).toBeGreaterThan(0);

    expect(
      await prisma.notificationDelivery.count({
        where: { enquiryId: soon, event: "quote_expiring" },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.notificationDelivery.count({
        where: { enquiryId: later, event: "quote_expiring" },
      }),
    ).toBe(0);
  });

  it("sends once, however many times the sweep runs", async () => {
    // `notify()` deduplicates nothing, so a daily sweep would otherwise send
    // this on every day of the window. The delivery log is the guard, the same
    // shape `sweepSetupNudges` uses.
    const enquiryId = await quote("ONCE", 1);

    await sweepExpiringQuotes();
    const first = await prisma.notificationDelivery.count({
      where: { enquiryId, event: "quote_expiring" },
    });
    expect(first).toBeGreaterThan(0);

    const second = await sweepExpiringQuotes();
    expect(second.alreadySent).toBeGreaterThan(0);
    expect(
      await prisma.notificationDelivery.count({ where: { enquiryId, event: "quote_expiring" } }),
    ).toBe(first);
  });

  it("says nothing about a quote whose window has already closed", async () => {
    // There is nothing to extend and nothing to decide. Board 3k is explicit
    // that an expired quote cannot be extended, and a notice about one would
    // send a seller to a row with no action on it.
    const gone = await quote("GONE", -1);
    await sweepExpiringQuotes();
    expect(
      await prisma.notificationDelivery.count({
        where: { enquiryId: gone, event: "quote_expiring" },
      }),
    ).toBe(0);
  });
});
