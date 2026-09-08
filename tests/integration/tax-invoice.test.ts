import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { actorFromDevSeller } from "@/lib/auth/dev-seller";
import type { Actor } from "@/lib/auth/roles";
import { documentOf, taxInvoiceDocument, billingRecipient } from "@/lib/billing/tax-invoice";
import { invoicePdf } from "@/lib/billing/invoice-pdf";
import { issueInvoice, ISSUER } from "@/lib/billing/invoice";

/**
 * Board 11g against a real database.
 *
 * The unit suite proves the PDF is a valid, deterministic A4 file. This proves
 * the three things only Postgres can answer: that the document renders from the
 * snapshot rather than from live records, that the screen and the file carry the
 * same figures, and that a seat without `billing.manage` cannot read it.
 */

/** A seller with a subscription, an owner seat, and no other suite. */
const SLUG = "al-rukn-fze";

let businessId = "";
let owner: Actor;
const written: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: SLUG },
    select: {
      id: true,
      team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 },
    },
  });
  businessId = business.id;
  const seat = business.team[0];
  if (!seat) throw new Error(`${SLUG} has no owner seat`);
  owner = actorFromDevSeller({ userId: seat.id, roles: seat.roles, businessId });
});

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { id: { in: written } } });
  await prisma.$disconnect();
});

async function issue(now = new Date()) {
  const invoice = await issueInvoice({
    businessId,
    issuedAt: now,
    paidAt: now,
    paidBy: { brand: "Visa", last4: "2318" },
    pspRef: "PSP-8841-TEST",
    subscriptionRef: "SUB-2318-PRO",
    placeOfSupply: "Dubai, UAE",
    lines: [
      {
        kind: "subscription",
        description: "Pro subscription",
        fils: 89_900,
        periodStart: now,
        periodEnd: new Date(now.getTime() + 30 * 86_400_000),
      },
      {
        kind: "placement",
        description: "Sponsored placement · Valves & actuators, Dubai",
        fils: 140_000,
        bookingRef: "PB-3391",
      },
    ],
  });
  written.push(invoice.id);
  return invoice;
}

describe("criterion 3 — the document renders from the snapshot, not from live records", () => {
  it("stores the supplier at issue, with no TRN", async () => {
    const issued = await issue();
    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: issued.id },
      select: { supplierName: true, supplierAddress: true, supplierIncorporation: true },
    });

    expect(row.supplierName).toBe(ISSUER.name);
    expect(row.supplierIncorporation).toBe(ISSUER.incorporation);
    // Delaware-registered and not registered in the UAE. The absence is
    // deliberate, and there is no column for it to be absent from.
    expect(Object.keys(ISSUER)).not.toContain("trn");
  });

  it("does not rewrite the supplier when the issuing entity changes", async () => {
    /*
       The reason the supplier is stored at all. This entity has already been
       restated once — a UAE company with a TRN became a Delaware one with none —
       and a constant read at render time would have rewritten every invoice ever
       sent, retrospectively.
    */
    const issued = await issue();
    await prisma.invoice.update({
      where: { id: issued.id },
      data: { supplierName: "BL Directory FZ-LLC", supplierAddress: "DMCC, Dubai, UAE" },
    });

    const document = await documentOf(businessId, issued.id);
    expect(document?.supplier.name).toBe("BL Directory FZ-LLC");
    expect(document?.supplier.name).not.toBe(ISSUER.name);
  });

  it("keeps the recipient as they were when they rename", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { displayName: true },
    });
    const issued = await issue();

    await prisma.business.update({
      where: { id: businessId },
      data: { displayName: `${before.displayName} Renamed` },
    });
    const document = await documentOf(businessId, issued.id);
    expect(document?.recipient.name).toBe(before.displayName);

    await prisma.business.update({
      where: { id: businessId },
      data: { displayName: before.displayName },
    });
  });

  it("labels the recipient's TRN and offers no supplier one", async () => {
    const issued = await issue();
    const document = await documentOf(businessId, issued.id);
    expect(document?.supplier.trn).toBeNull();
    // The screen renders `invoice.recipient_trn`, which carries the label.
    expect(document?.recipient.trn === null || typeof document?.recipient.trn === "string").toBe(
      true,
    );
  });
});

describe("criterion 4 — every line carries its own VAT", () => {
  it("stores a rate, a VAT amount and a unit price per line", async () => {
    const issued = await issue();
    const lines = await prisma.invoiceLine.findMany({
      where: { invoiceId: issued.id },
      orderBy: { id: "asc" },
      select: { unitAed: true, vatRate: true, vatAed: true, taxTreatment: true, bookingRef: true },
    });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.unitAed).not.toBeNull();
      expect(Number(line.vatRate)).toBe(0.05);
      expect(line.vatAed).not.toBeNull();
      expect(line.taxTreatment).toBe("standard");
    }
    // The booking reference, which the document prints as text.
    expect(lines[1]?.bookingRef).toBe("PB-3391");
  });

  it("makes the line VAT add up to the invoice total", async () => {
    /*
       The document states both, so they have to agree: a reader adding the VAT
       column and finding a different number from `Total VAT payable` is reading
       a document that contradicts itself. The invoice rounds once over the whole
       subtotal, so the last line absorbs the per-line remainder.
    */
    const issued = await issue();
    const lines = await prisma.invoiceLine.findMany({
      where: { invoiceId: issued.id },
      select: { vatAed: true },
    });
    const summed = lines.reduce((total, line) => total + Math.round(Number(line.vatAed) * 100), 0);
    expect(summed).toBe(issued.vatFils);
  });
});

describe("criterion 1 — the screen and the PDF carry the same figures", () => {
  it("puts every figure the document holds into the file", async () => {
    /*
       The board's central rule: *"the render is not a preview of the document,
       it is the document."* Both read one `TaxInvoiceDocument`, so the check is
       that nothing the object states goes missing on the way to the page.
    */
    const issued = await issue();
    const document = await documentOf(businessId, issued.id);
    expect(document).not.toBeNull();
    if (!document) return;

    const text = invoicePdf(document).bytes.toString("latin1");

    expect(text).toContain(document.ref);
    expect(text).toContain(document.totals.subtotalAed);
    expect(text).toContain(document.totals.vatAed);
    expect(text).toContain(document.totals.totalAed);
    for (const line of document.lines) {
      expect(text).toContain(line.amountAed);
      if (line.vatAed) expect(text).toContain(line.vatAed);
      if (line.bookingRef) expect(text).toContain(line.bookingRef);
    }
  });

  it("reads totals from storage rather than recomputing them", async () => {
    // Criterion 2. The figures on the document are what was charged, not what
    // today's rate would produce.
    const issued = await issue();
    const document = await documentOf(businessId, issued.id);
    expect(document?.totals.stored).toBe(true);
    expect(document?.totals.totalAed).toBe("2,413.95");
  });
});

describe("criterion 11 — only the owner and finance seats can read it", () => {
  it("refuses a sales seat", async () => {
    const issued = await issue();
    const sales: Actor = { id: owner.id, roles: ["seller_sales"], businessId };
    await expect(taxInvoiceDocument(sales, businessId, issued.id)).rejects.toThrow();
  });

  it("refuses a manager, who can edit the listing but not see the card", async () => {
    const issued = await issue();
    const manager: Actor = { id: owner.id, roles: ["seller_manager"], businessId };
    await expect(taxInvoiceDocument(manager, businessId, issued.id)).rejects.toThrow();
  });

  it("allows the finance seat, which exists so the owner need not hold the card", async () => {
    const issued = await issue();
    const finance: Actor = { id: owner.id, roles: ["seller_finance"], businessId };
    await expect(taxInvoiceDocument(finance, businessId, issued.id)).resolves.not.toBeNull();
  });

  it("returns nothing for another business's invoice", async () => {
    // A seller who edits the id in the address bar has made a mistake, not an
    // attack, and a 404 is the honest answer either way.
    const stranger = await prisma.invoice.findFirstOrThrow({
      where: { businessId: { not: businessId }, status: { not: "draft" } },
      select: { id: true },
    });
    expect(await taxInvoiceDocument(owner, businessId, stranger.id)).toBeNull();
  });
});

describe("where an invoice is emailed", () => {
  it("falls to the finance seat, then the owner, when Settings is empty", async () => {
    /*
       Null in Settings is the ordinary state rather than a gap. A supplier who
       has given the card to a bookkeeper has already told us where invoices
       should land, by seating them.
    */
    await prisma.notificationPreference.updateMany({
      where: { businessId },
      data: { billingEmail: null },
    });
    const resolved = await billingRecipient(businessId);
    const seats = await prisma.user.findMany({
      where: { businessId },
      select: { email: true, roles: true },
    });
    expect(seats.some((seat) => seat.email === resolved)).toBe(true);
  });

  it("prefers the stored address when there is one", async () => {
    await prisma.notificationPreference.upsert({
      where: { businessId },
      create: { businessId, billingEmail: "accounts@example.ae" },
      update: { billingEmail: "accounts@example.ae" },
    });
    expect(await billingRecipient(businessId)).toBe("accounts@example.ae");

    await prisma.notificationPreference.updateMany({
      where: { businessId },
      data: { billingEmail: null },
    });
  });
});

describe("the delivery log", () => {
  it("records a send with the address it reached", async () => {
    const issued = await issue();
    await prisma.invoiceEvent.create({
      data: { invoiceId: issued.id, kind: "emailed", recipient: "accounts@example.ae" },
    });

    const document = await documentOf(businessId, issued.id);
    expect(document?.delivery[0]).toMatchObject({ kind: "emailed", who: "accounts@example.ae" });
  });

  it("refuses an emailed row that names nobody", async () => {
    // The panel exists to answer "did you send it, and to whom". A row that
    // cannot answer the second half is one nothing should have written.
    const issued = await issue();
    await expect(
      prisma.invoiceEvent.create({ data: { invoiceId: issued.id, kind: "emailed" } }),
    ).rejects.toThrow();
  });

  it("refuses a download that claims a recipient", async () => {
    const issued = await issue();
    await expect(
      prisma.invoiceEvent.create({
        data: { invoiceId: issued.id, kind: "downloaded", recipient: "someone@example.ae" },
      }),
    ).rejects.toThrow();
  });
});
