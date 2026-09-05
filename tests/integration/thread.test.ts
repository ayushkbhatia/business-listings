import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getThread, nudge, postMessage } from "@/lib/messaging/service";
import { sendQuoteForBusiness } from "@/lib/quote/send-quote";
import { getBuyerEnquiry } from "@/lib/db/queries/enquiry";
import { delta, parseAedToFils } from "@/lib/quote/money";
import type { Actor } from "@/lib/auth/roles";

/**
 * The handoff 2 step 4 checkpoint:
 *
 *   "a revision round-trip, and an IBAN in a message raising a report."
 *
 * Plus acceptance criteria 4 and 7. Against a real database, through the same
 * services the two thread views call.
 */

const ENQUIRY_ID = "seedenquiryprovisional0001";

let businessId: string;
let sellerId: string;
let buyerId: string;
let enquiryLineIds: string[];

const createdMessageIds: string[] = [];
const createdReportIds: string[] = [];
const createdQuoteIds: string[] = [];

beforeAll(async () => {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({
    where: { id: ENQUIRY_ID },
    select: {
      buyerId: true,
      lines: { select: { id: true }, orderBy: { sortOrder: "asc" } },
      recipients: { select: { businessId: true, state: true }, orderBy: { businessId: "asc" } },
    },
  });
  buyerId = enquiry.buyerId;
  enquiryLineIds = enquiry.lines.map((l) => l.id);
  businessId = enquiry.recipients.find((r) => r.state === "quoted")!.businessId;

  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true },
  });
  sellerId = seat.id;
});

afterEach(async () => {
  await prisma.message.deleteMany({ where: { id: { in: createdMessageIds.splice(0) } } });
  await prisma.supplierReport.deleteMany({ where: { id: { in: createdReportIds.splice(0) } } });
  await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds.splice(0) } } });
  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId: ENQUIRY_ID, businessId } },
    data: { sellerNudgedAt: null },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function post(sender: "buyer" | "seller", body: string) {
  const result = await postMessage({
    enquiryId: ENQUIRY_ID,
    businessId,
    senderId: sender === "buyer" ? buyerId : sellerId,
    sender,
    body,
  });
  if (result.ok) {
    createdMessageIds.push(result.messageId);
    if (result.reportId) createdReportIds.push(result.reportId);
  }
  return result;
}

describe("the thread", () => {
  it("carries both sides, in order", async () => {
    await post("buyer", "Can you bring the DN200 lead time inside two weeks?");
    await post("seller", "We can do ten days if you confirm this week.");

    const thread = await getThread(ENQUIRY_ID, businessId);
    expect(thread).not.toBeNull();
    expect(thread!.map((m) => m.fromSeller)).toEqual([false, true]);
    expect(thread![0]!.body).toContain("DN200");
  });

  it("is scoped to one supplier — the other seven cannot read it", async () => {
    await post("buyer", "A question only for this supplier.");

    const other = await prisma.enquiryRecipient.findFirstOrThrow({
      where: { enquiryId: ENQUIRY_ID, businessId: { not: businessId } },
      select: { businessId: true },
    });
    const theirs = await getThread(ENQUIRY_ID, other.businessId);
    expect(theirs).toEqual([]);
  });

  it("returns null to a business the enquiry never reached", async () => {
    const stranger = await prisma.business.findFirstOrThrow({
      where: { recipients: { none: { enquiryId: ENQUIRY_ID } } },
      select: { id: true },
    });
    expect(await getThread(ENQUIRY_ID, stranger.id)).toBeNull();
  });

  it("refuses a message from somebody who is not the buyer", async () => {
    const result = await postMessage({
      enquiryId: ENQUIRY_ID,
      businessId,
      senderId: sellerId,
      sender: "buyer",
      body: "Pretending to be the buyer.",
    });
    expect(result).toEqual({ ok: false, error: "not_a_participant" });
  });

  it("refuses an empty message rather than storing whitespace", async () => {
    expect(await post("buyer", "   ")).toEqual({ ok: false, error: "empty" });
  });
});

describe("criterion 7 — an IBAN raises a report", () => {
  it("creates a supplier report against the seller, with the message quoted", async () => {
    const body =
      "Please transfer the 50% advance to AE070331234567890123456 and we will release the stock.";
    const result = await post("seller", body);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.flagged).toBe(true);
    expect(result.reportId).not.toBeNull();

    const report = await prisma.supplierReport.findUniqueOrThrow({
      where: { id: result.reportId! },
    });
    expect(report.kind).toBe("off_platform_payment");
    expect(report.subjectBusinessId).toBe(businessId);
    // Raised by the platform, not by a person. That is what a null reporter
    // means, and it is how the queue tells the two apart.
    expect(report.reporterId).toBeNull();
    expect(report.detail).toContain("AE070331234567890123456");
    expect(report.subjectField).toBe(`message:${result.messageId}`);
  });

  it("marks the message itself, so the thread shows it happened", async () => {
    const result = await post("seller", "Wire the balance to a/c no. 1234567890123 today.");
    if (!result.ok) throw new Error("unreachable");
    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.messageId } });
    expect(message.flaggedAt).not.toBeNull();
  });

  it("does not report ordinary trade language", async () => {
    const before = await prisma.supplierReport.count();
    for (const body of [
      "Our TRN is 100487213600003 for the paperwork.",
      "We can do 30 days from invoice on a repeat order.",
      "Call the yard on +971 4 391 7937 before you send the truck.",
    ]) {
      const result = await post("seller", body);
      expect(result.ok && result.reportId, body).toBeNull();
    }
    expect(await prisma.supplierReport.count()).toBe(before);
  });
});

describe("criterion 4 — a revision is a new row", () => {
  it("keeps both quotes and shows what changed", async () => {
    const actor: Actor = { id: sellerId, roles: ["seller_owner"], businessId };
    const lines = enquiryLineIds.map((id, i) => ({
      enquiryLineId: id,
      productId: null,
      description: `Line ${i + 1}`,
      qty: 4,
      unitPrice: "1000.00",
      leadTimeDays: 14,
    }));

    const r1 = await sendQuoteForBusiness(actor, businessId, {
      enquiryId: ENQUIRY_ID,
      note: "First pass.",
      validityDays: 14,
      lines,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("unreachable");
    createdQuoteIds.push(r1.quoteId);

    const r2 = await sendQuoteForBusiness(actor, businessId, {
      enquiryId: ENQUIRY_ID,
      note: "Revised after your call.",
      validityDays: 10,
      lines: lines.map((l) => ({ ...l, unitPrice: "940.00", leadTimeDays: 7 })),
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("unreachable");
    createdQuoteIds.push(r2.quoteId);

    // A new row, not an edit. Both survive.
    expect(r2.revision).toBe(r1.revision + 1);
    const rows = await prisma.quote.findMany({
      where: { id: { in: [r1.quoteId, r2.quoteId] } },
      select: { revision: true },
    });
    expect(rows).toHaveLength(2);

    // And the delta the thread renders beside the struck-through price.
    const previous = parseAedToFils("1000.00") * BigInt(4) * BigInt(lines.length);
    const current = parseAedToFils("940.00") * BigInt(4) * BigInt(lines.length);
    const change = delta(previous, current);
    expect(change.direction).toBe("down");
    expect(change.percent).toBe(-6);
  });

  it("shows the buyer only the current revision, with the earlier one in the thread", async () => {
    const actor: Actor = { id: sellerId, roles: ["seller_owner"], businessId };
    const lines = [
      {
        enquiryLineId: enquiryLineIds[0]!,
        productId: null,
        description: "Wafer butterfly valve DN200",
        qty: 12,
        unitPrice: "935.00",
        leadTimeDays: 2,
      },
    ];
    const r1 = await sendQuoteForBusiness(actor, businessId, {
      enquiryId: ENQUIRY_ID, note: null as unknown as string, validityDays: 14, lines,
    });
    if (!r1.ok) throw new Error("unreachable");
    createdQuoteIds.push(r1.quoteId);
    const r2 = await sendQuoteForBusiness(actor, businessId, {
      enquiryId: ENQUIRY_ID,
      note: "Held the price, pulled the lead time in.",
      validityDays: 14,
      lines: lines.map((l) => ({ ...l, leadTimeDays: 1 })),
    });
    if (!r2.ok) throw new Error("unreachable");
    createdQuoteIds.push(r2.quoteId);

    const enquiry = await getBuyerEnquiry(buyerId, ENQUIRY_ID);
    const fromThisSeller = enquiry!.quotes.filter((q) => q.business.id === businessId);
    // One row per supplier: their current revision. Comparing against a
    // superseded price is how a buyer accepts the wrong number.
    expect(fromThisSeller).toHaveLength(1);
    expect(fromThisSeller[0]!.revision).toBe(r2.revision);
  });
});

describe("the one nudge", () => {
  it("is allowed once, and only after a quote has gone out", async () => {
    const first = await nudge(ENQUIRY_ID, businessId);
    expect(first.ok).toBe(true);
  });

  it("is refused the second time, because a second loses more deals than it wins", async () => {
    await nudge(ENQUIRY_ID, businessId);
    expect(await nudge(ENQUIRY_ID, businessId)).toEqual({ ok: false, error: "already_nudged" });
  });

  it("is refused before there is anything to follow up on", async () => {
    const unquoted = await prisma.enquiryRecipient.findFirstOrThrow({
      where: { enquiryId: ENQUIRY_ID, state: { not: "quoted" } },
      select: { businessId: true },
    });
    expect(await nudge(ENQUIRY_ID, unquoted.businessId)).toEqual({
      ok: false,
      error: "no_reply_needed",
    });
  });

  it("cannot be counted past one, because the column is a timestamp", async () => {
    // The schema cannot express "three nudges", so no future screen can offer
    // them. That is the point of the column's type.
    const column = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'enquiry_recipient' AND column_name = 'nudged_at'`;
    expect(column[0]?.data_type).toMatch(/timestamp/);
  });
});
