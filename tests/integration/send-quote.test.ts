import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { PermissionError } from "@/lib/auth/errors";
import { sendQuoteForBusiness, type SendQuoteInput } from "@/lib/quote/send-quote";

/**
 * The write side of the quote composer, against a real database.
 *
 * Two things are being proved. The invariants — a seller cannot price a line
 * that is not on the enquiry, cannot attach another supplier's product, cannot
 * quote a closed enquiry. And the shape of what a send actually writes: a
 * quote, its lines, and one recipient row. Nothing else. There is no order
 * table in this product and this is where that stays true.
 */

/**
 * The supplier the step 1 fixture aims at. Hardcoded, as the e2e specs are and
 * for the same reason: the seed's PRNG is fixed, so this is stable, and if the
 * seed changes these fail loudly rather than quietly testing something else.
 */
const SELLER_SLUG = "al-marwan-industrial-supplies-llc";

let businessId: string;
let owner: Actor;
let enquiryId: string;
let enquiryLineIds: string[];
let ownProductId: string;
let foreignProductId: string;

const createdQuoteIds: string[] = [];

beforeAll(async () => {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({
    where: { ref: "ENQ-8863" },
    select: {
      id: true,
      lines: { select: { id: true, description: true, qty: true }, orderBy: { sortOrder: "asc" } },
      recipients: { select: { businessId: true, state: true } },
    },
  });
  enquiryId = enquiry.id;
  enquiryLineIds = enquiry.lines.map((l) => l.id);
  const seller = await prisma.business.findUniqueOrThrow({
    where: { slug: SELLER_SLUG },
    select: { id: true },
  });
  businessId = seller.id;
  expect(
    enquiry.recipients.some((r) => r.businessId === businessId),
    `${SELLER_SLUG} must be a recipient of ENQ-8863`,
  ).toBe(true);

  // Start from a clean slate. A quote sent by hand through the dashboard during
  // development would otherwise make the first revision a second one.
  await resetRecipient();

  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true, roles: true },
  });
  owner = { id: seat.id, roles: seat.roles, businessId };

  ownProductId = (await prisma.product.findFirstOrThrow({ where: { businessId }, select: { id: true } })).id;
  foreignProductId = (
    await prisma.product.findFirstOrThrow({
      where: { businessId: { not: businessId } },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  createdQuoteIds.length = 0;
  await resetRecipient();
});

/** "This seller has not quoted this enquiry", which every test starts from. */
async function resetRecipient() {
  await prisma.quote.deleteMany({ where: { enquiryId, businessId } });
  await prisma.enquiryRecipient.update({
    where: { enquiryId_businessId: { enquiryId, businessId } },
    data: { state: "delivered", firstReplyAt: null, openedAt: null },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

function input(over: Partial<SendQuoteInput> = {}): SendQuoteInput {
  return {
    enquiryId,
    note: "Two sizes ex-stock. The large trunnion valve is an indent item.",
    validityDays: 14,
    lines: enquiryLineIds.map((id, i) => ({
      enquiryLineId: id,
      productId: i === 0 ? ownProductId : null,
      description: `Line ${i + 1}`,
      qty: 4,
      unitPrice: "100.00",
      leadTimeDays: i === 0 ? 0 : 84,
    })),
    ...over,
  };
}

async function send(over: Partial<SendQuoteInput> = {}) {
  const result = await sendQuoteForBusiness(owner, businessId, input(over));
  if (result.ok) createdQuoteIds.push(result.quoteId);
  return result;
}

describe("what a send writes", () => {
  it("creates a quote, its lines, and nothing else", async () => {
    const before = await tableCounts();
    const result = await send();
    expect(result.ok).toBe(true);
    const after = await tableCounts();

    expect(after.quote - before.quote).toBe(1);
    expect(after.quoteLine - before.quoteLine).toBe(3);

    // The rows that must not appear, named individually so a failure says which
    // one. There is no order, payment, fulfilment or invoice in an enquiry.
    expect(after.invoice).toBe(before.invoice);
    expect(after.enquiry).toBe(before.enquiry);
    expect(after.enquiryLine).toBe(before.enquiryLine);
    expect(after.enquiryRecipient).toBe(before.enquiryRecipient);
    expect(after.message).toBe(before.message);
    expect(after.review).toBe(before.review);
    expect(after.supplierReport).toBe(before.supplierReport);
    expect(after.auditEvent).toBe(before.auditEvent);
  });

  it("moves the recipient to quoted and stamps the first reply once", async () => {
    const first = await send();
    expect(first.ok).toBe(true);

    const afterFirst = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId, businessId } },
      select: { state: true, firstReplyAt: true },
    });
    expect(afterFirst.state).toBe("quoted");
    expect(afterFirst.firstReplyAt).not.toBeNull();

    // A revision is a reply too, but not the first one. Response time is
    // measured from the first, so the stamp must not move.
    const revision = await send();
    expect(revision.ok).toBe(true);
    const afterSecond = await prisma.enquiryRecipient.findUniqueOrThrow({
      where: { enquiryId_businessId: { enquiryId, businessId } },
      select: { firstReplyAt: true },
    });
    expect(afterSecond.firstReplyAt?.getTime()).toBe(afterFirst.firstReplyAt?.getTime());
  });

  it("numbers a revision rather than editing the quote", async () => {
    const r1 = await send();
    const r2 = await send();
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error("unreachable");

    expect(r1.revision).toBe(1);
    expect(r2.revision).toBe(2);
    expect(r2.quoteRef).not.toBe(r1.quoteRef);
    expect(r2.quoteRef).toMatch(/R2$/);

    // Both rows survive. The buyer sees the previous price struck through.
    const rows = await prisma.quote.count({ where: { enquiryId, businessId } });
    expect(rows).toBe(2);
  });

  it("materialises the expiry from the validity the seller chose", async () => {
    const result = await send({ validityDays: 21 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: result.quoteId },
      select: { sentAt: true, expiresAt: true, validityDays: true },
    });
    expect(quote.validityDays).toBe(21);
    const days = (quote.expiresAt!.getTime() - quote.sentAt!.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(21);
  });

  it("coerces a validity nobody offered rather than storing it", async () => {
    const result = await send({ validityDays: 9999 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: result.quoteId },
      select: { validityDays: true },
    });
    expect(quote.validityDays).toBe(14);
  });
});

describe("what a send refuses", () => {
  it("refuses a business the enquiry was never sent to", async () => {
    const stranger = await prisma.business.findFirstOrThrow({
      where: { id: { not: businessId }, team: { some: { roles: { has: "seller_owner" } } } },
      select: { id: true, team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 } },
    });
    const other: Actor = {
      id: stranger.team[0]!.id,
      roles: stranger.team[0]!.roles,
      businessId: stranger.id,
    };
    const result = await sendQuoteForBusiness(other, stranger.id, input());
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not sent to your business") });
  });

  it("refuses a line that is not on the enquiry", async () => {
    const foreignLine = await prisma.enquiryLine.findFirstOrThrow({
      where: { enquiryId: { not: enquiryId } },
      select: { id: true },
    });
    const result = await send({
      lines: [
        {
          enquiryLineId: foreignLine.id,
          productId: null,
          description: "Something the buyer never asked for",
          qty: 1,
          unitPrice: "1000.00",
          leadTimeDays: null,
        },
      ],
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("not on the enquiry") });
  });

  it("refuses another supplier's product on the line", async () => {
    const result = await send({
      lines: [
        {
          enquiryLineId: enquiryLineIds[0]!,
          productId: foreignProductId,
          description: "A competitor's SKU",
          qty: 1,
          unitPrice: "500.00",
          leadTimeDays: null,
        },
      ],
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("does not belong to your catalogue") });
  });

  it("refuses a price that is not an amount in dirhams", async () => {
    for (const unitPrice of ["", "abc", "10.005", "1e3", "-5.00"]) {
      const result = await send({
        lines: [
          {
            enquiryLineId: enquiryLineIds[0]!,
            productId: null,
            description: "Brass ball valve",
            qty: 1,
            unitPrice,
            leadTimeDays: null,
          },
        ],
      });
      expect(result.ok, `"${unitPrice}" should be refused`).toBe(false);
    }
  });

  it("refuses a quote with no lines", async () => {
    const result = await send({ lines: [] });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("at least one line") });
  });

  it("refuses an actor without the capability", async () => {
    const buyer: Actor = { id: owner.id, roles: ["buyer"], businessId };
    await expect(sendQuoteForBusiness(buyer, businessId, input())).rejects.toBeInstanceOf(PermissionError);
  });

  it("refuses a closed enquiry", async () => {
    const closed = await prisma.enquiry.findUniqueOrThrow({
      where: { ref: "ENQ-8802" },
      select: { id: true, lines: { select: { id: true } }, contactReleasedToBusinessId: true },
    });
    const winner = closed.contactReleasedToBusinessId!;
    const seat = await prisma.user.findFirstOrThrow({
      where: { businessId: winner, roles: { has: "seller_owner" } },
      select: { id: true, roles: true },
    });
    const result = await sendQuoteForBusiness(
      { id: seat.id, roles: seat.roles, businessId: winner },
      winner,
      {
        enquiryId: closed.id,
        note: "",
        validityDays: 14,
        lines: [
          {
            enquiryLineId: closed.lines[0]!.id,
            productId: null,
            description: "GI pipe",
            qty: 1,
            unitPrice: "100.00",
            leadTimeDays: null,
          },
        ],
      },
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining("can no longer be sent") });
  });
});

async function tableCounts() {
  const [
    quote,
    quoteLine,
    invoice,
    enquiry,
    enquiryLine,
    enquiryRecipient,
    message,
    review,
    supplierReport,
    auditEvent,
  ] = await Promise.all([
    prisma.quote.count(),
    prisma.quoteLine.count(),
    prisma.invoice.count(),
    prisma.enquiry.count(),
    prisma.enquiryLine.count(),
    prisma.enquiryRecipient.count(),
    prisma.message.count(),
    prisma.review.count(),
    prisma.supplierReport.count(),
    prisma.auditEvent.count(),
  ]);
  return {
    quote,
    quoteLine,
    invoice,
    enquiry,
    enquiryLine,
    enquiryRecipient,
    message,
    review,
    supplierReport,
    auditEvent,
  };
}
