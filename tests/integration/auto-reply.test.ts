import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { fill, sendAutoReply, unknownTokens } from "@/lib/messaging/auto-reply";

/**
 * Board 7e §4 — the acknowledgement, and the clock it must not stop.
 *
 * "The board's card said it counts as a first response. It cannot, and this is
 * the most consequential correction in either screen."
 *
 * The first test in this file is the one that matters. If an automated message
 * could stamp `firstReplyAt`, the band every buyer reads on a listing, the
 * reply-time weight in search ranking, board 3a's median, board 3k's speed card
 * and board 7d's per-seat medians would all report a number no human produced —
 * and every seller would switch a template on for that reason inside a month.
 */

const PREFIX = "7E-AUTOREPLY-FIXTURE";

let businessId: string;
let buyerId: string;
let originalEnabled: boolean;
let originalBody: string | null;

const enquiries: string[] = [];

beforeAll(async () => {
  /*
     A supplier with published hours, because "out of hours" is read from them.
     A business with no week is never out of hours — the same rule
     `lib/leads/router.ts` applies to the routing skip — so one without would
     make every case here return `no_hours` and prove nothing.
  */
  const business = await prisma.business.findFirstOrThrow({
    where: {
      claimStatus: "claimed",
      locations: { some: { published: true } },
      team: { some: { roles: { has: "seller_owner" } } },
    },
    orderBy: { slug: "asc" },
    select: { id: true, autoReplyEnabled: true, autoReplyBody: true },
  });
  businessId = business.id;
  originalEnabled = business.autoReplyEnabled;
  originalBody = business.autoReplyBody;

  buyerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  const ids = enquiries.splice(0);
  if (ids.length > 0) await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.business.update({
    where: { id: businessId },
    data: { autoReplyEnabled: originalEnabled, autoReplyBody: originalBody },
  });
  await prisma.$disconnect();
});

async function lead(label: string): Promise<string> {
  const enquiry = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}`,
      buyerId,
      requirement: `${PREFIX} ${label} — gate valves for a riser.`,
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      lines: { create: [{ description: `${PREFIX} valve`, qty: 4, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  enquiries.push(enquiry.id);
  await prisma.enquiryRecipient.create({ data: { enquiryId: enquiry.id, businessId } });
  return enquiry.id;
}

/** Three in the morning, Dubai. No published counter is open at this hour. */
const SHUT = new Date("2026-09-07T23:00:00Z");
/** Tuesday, ten in the morning. Inside the seeded working week. */
const OPEN = new Date("2026-09-08T06:00:00Z");

describe("the acknowledgement does not stop the clock", () => {
  it("posts a message and leaves firstReplyAt null", async () => {
    await prisma.business.update({
      where: { id: businessId },
      data: { autoReplyEnabled: true, autoReplyBody: null },
    });
    const enquiryId = await lead("A");

    const outcome = await sendAutoReply({ enquiryId, businessId, now: SHUT });
    expect(outcome.sent).toBe(true);

    const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId, businessId } },
      select: { firstReplyAt: true },
    });
    // The line the whole card exists for.
    expect(recipient.firstReplyAt).toBeNull();

    const message = await prisma.message.findFirstOrThrow({
      where: { enquiryId, businessId },
      select: { automatic: true, body: true },
    });
    // And tagged, because board 11b shows a buyer when they did not get a person.
    expect(message.automatic).toBe(true);
    expect(message.body.length).toBeGreaterThan(0);
  });

  it("still lets a person's reply stamp it afterwards", async () => {
    /*
       The other half of the same rule. An automatic message that blocked a
       later human one from stamping would be the same defect wearing the
       opposite sign: a seller who answered in four minutes would read as never
       having answered at all.
    */
    await prisma.business.update({
      where: { id: businessId },
      data: { autoReplyEnabled: true, autoReplyBody: null },
    });
    const enquiryId = await lead("B");
    await sendAutoReply({ enquiryId, businessId, now: SHUT });

    const owner = await prisma.user.findFirstOrThrow({
      where: { businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    const { postMessage } = await import("@/lib/messaging/service");
    await postMessage({
      enquiryId,
      businessId,
      senderId: owner.id,
      sender: "seller",
      body: `${PREFIX} a person, typing.`,
    });

    const recipient = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId, businessId } },
      select: { firstReplyAt: true },
    });
    expect(recipient.firstReplyAt).not.toBeNull();
  });
});

describe("when it fires", () => {
  it("says nothing while the counter is open", async () => {
    await prisma.business.update({
      where: { id: businessId },
      data: { autoReplyEnabled: true, autoReplyBody: null },
    });
    const enquiryId = await lead("C");

    expect(await sendAutoReply({ enquiryId, businessId, now: OPEN })).toEqual({
      sent: false,
      reason: "open",
    });
    expect(await prisma.message.count({ where: { enquiryId } })).toBe(0);
  });

  it("says nothing when the seller has not switched it on", async () => {
    await prisma.business.update({
      where: { id: businessId },
      data: { autoReplyEnabled: false },
    });
    const enquiryId = await lead("D");

    expect(await sendAutoReply({ enquiryId, businessId, now: SHUT })).toEqual({
      sent: false,
      reason: "off",
    });
  });
});

describe("the three tokens", () => {
  it("fills the ones it knows and leaves the rest exactly as typed", () => {
    /*
       An unknown token reaching a buyer as `{first_name}` mid-sentence reads as
       a broken supplier rather than a broken setting — which is why the save
       guard refuses one, and why this leaves it visible rather than blanking it
       if one ever gets through.
    */
    const filled = fill("Hello {buyer_name}, we open {next_open_time}. Ask {nobody}.", {
      buyer_name: "Khalid",
      next_open_time: "08:00 on Sunday",
      whatsapp_number: "+971500000000",
    });
    expect(filled).toBe("Hello Khalid, we open 08:00 on Sunday. Ask {nobody}.");
  });

  it("names what a save should refuse", () => {
    expect(unknownTokens("Hello {buyer_name} and {first_name} and {company}")).toEqual([
      "first_name",
      "company",
    ]);
    expect(unknownTokens("Hello {buyer_name}, we open {next_open_time}.")).toEqual([]);
  });
});
