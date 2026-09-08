import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanManageBilling } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { formatAED, formatDate, formatTRN } from "@/lib/format";
import { FILS_PER_AED } from "./proration";
import { storedTotals } from "./invoice";

/**
 * Board 11g — the document, as one object.
 *
 * **The render is not a preview of the document. It is the document.** A seller
 * who forwards the PDF and a seller who screenshots the screen must be sending
 * the same evidence, and the only way to make that checkable rather than
 * asserted is for both renderings to read one structure. This is it: the screen
 * lays it out as HTML, `invoice-pdf.ts` lays the same fields out as A4, and
 * neither computes anything.
 *
 * ## Every string is already formatted
 *
 * Deliberately. A figure formatted twice is a figure formatted two ways, and the
 * pair of boards this wave opened with existed because one invoice number
 * carried two totals. The PDF writer has no access to `Intl`; if it formatted
 * its own money it would drift from the screen the first time a separator
 * changed.
 *
 * ## Nothing here recomputes
 *
 * Criterion 2. Totals come from `storedTotals`, line VAT from the stored
 * columns, and the parties from the snapshot taken at issue. Where a value was
 * not stored — an invoice written before board 11g — the field is null and the
 * surface says so rather than deriving a number that would be indistinguishable
 * from one that was actually charged.
 */

/** What a party looked like on the day. */
export interface DocumentParty {
  name: string;
  addressLines: string[];
  /**
   * Only ever the recipient's, and labelled as such.
   *
   * The issuing entity is registered in Delaware and holds no TRN. With one tax
   * number on a page an unlabelled one reads as the issuer's, which is why this
   * renders as `Recipient TRN` and why there is no supplier equivalent.
   */
  trn: string | null;
  /** `Incorporated in Delaware, USA`. Supplier only. */
  incorporation: string | null;
}

export interface DocumentLine {
  id: string;
  description: string;
  /** `14 Aug – 13 Sep 2026 · standard rate`, or just the treatment. */
  detail: string;
  /** `Booking PB-3391`, where the line bills one. Text, never a link — `11e`. */
  bookingRef: string | null;
  qty: string;
  /** Ex-VAT, per unit. Null on a line written before the column existed. */
  unitAed: string | null;
  /** `5%`, `0%`, or null where nothing was stored. */
  rate: string | null;
  vatAed: string | null;
  amountAed: string;
}

export interface DocumentTotals {
  subtotalAed: string;
  vatAed: string;
  totalAed: string;
  /** False where the figures fell back to summing the lines. */
  stored: boolean;
  currency: string;
}

export interface DocumentPayment {
  paidOn: string;
  brand: string | null;
  last4: string | null;
  /** `Emirates NBD`. The issuer of the card, where the record has one. */
  bank: string | null;
}

export interface DocumentReferences {
  pspRef: string | null;
  subscriptionRef: string | null;
}

export interface StoredPdf {
  path: string;
  bytes: number;
}

export interface DeliveryEvent {
  id: string;
  kind: "emailed" | "downloaded";
  /** Already resolved: an address, or the person's name. */
  who: string;
  when: string;
}

export interface TaxInvoiceDocument {
  id: string;
  ref: string;
  /** `tax_invoice` or `credit_note`. The heading follows it. */
  docType: "tax_invoice" | "credit_note";
  status: string;
  supplier: DocumentParty;
  recipient: DocumentParty;
  /** Every date the document states, individually labelled. */
  issuedOn: string;
  suppliedOn: string | null;
  /** `14 Aug – 13 Sep 2026`, summarised from the lines that carry a period. */
  supplyPeriod: string | null;
  placeOfSupply: string | null;
  lines: DocumentLine[];
  totals: DocumentTotals;
  payment: DocumentPayment | null;
  references: DocumentReferences;
  /** What it corrects, on a credit note. The slot Q5 asked to reserve. */
  correctsRef: string | null;
  pdf: StoredPdf | null;
  /** Screen-only. Tagged `NOT IN THE PDF` wherever it renders. */
  delivery: DeliveryEvent[];
  /** Where the invoice is emailed by default, from board 7e's settings. */
  billingEmail: string | null;
}

const RATE_LABEL: Record<string, string> = {
  standard: "standard rate",
  zero_rated: "zero-rated",
  exempt: "exempt",
  out_of_scope: "outside the scope of UAE VAT",
};

/**
 * One invoice, as the document.
 *
 * Guarded on `billing.manage` — owner and finance, per board 7d. Criterion 11
 * is that a staff seat cannot reach this route *by URL* either, and the guard
 * here is what makes that true: the page's own `notFound` hides the nav, this
 * refuses the read.
 *
 * Returns null for an invoice belonging to another business. Not a throw: a
 * seller who edits the id in the address bar has made a mistake, not an attack,
 * and a 404 is the honest answer either way.
 */
export async function taxInvoiceDocument(
  actor: Actor,
  businessId: string,
  invoiceId: string,
): Promise<TaxInvoiceDocument | null> {
  assertCanManageBilling(actor);
  return documentOf(businessId, invoiceId);
}

/**
 * The same document, without the capability check.
 *
 * For the PDF writer, which runs at issue from a service with no actor — nobody
 * is signed in when a renewal charges a card at three in the morning. Every
 * *request-shaped* caller goes through `taxInvoiceDocument` above, which is the
 * one that guards.
 *
 * Not exported to a screen. The split exists so the PDF and the screen render
 * one object rather than two assemblies of the same columns; it is not a way
 * around the guard, and the only other caller is `writeInvoicePdf`.
 */
export async function documentOf(
  businessId: string,
  invoiceId: string,
): Promise<TaxInvoiceDocument | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      ref: true,
      businessId: true,
      docType: true,
      status: true,
      vatRate: true,
      issuedAt: true,
      supplyDate: true,
      placeOfSupply: true,
      currency: true,
      paidAt: true,
      paidByBrand: true,
      paidByLast4: true,
      pspRef: true,
      subscriptionRef: true,
      pdfPath: true,
      pdfBytes: true,
      subtotalFils: true,
      vatFils: true,
      totalFils: true,
      supplierName: true,
      supplierAddress: true,
      supplierIncorporation: true,
      billedToName: true,
      billedToTrn: true,
      billedToAddress: true,
      corrects: { select: { ref: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          kind: true,
          description: true,
          qty: true,
          amountAed: true,
          unitAed: true,
          vatRate: true,
          vatAed: true,
          taxTreatment: true,
          bookingRef: true,
          periodStart: true,
          periodEnd: true,
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          kind: true,
          recipient: true,
          createdAt: true,
          actor: { select: { fullName: true, email: true } },
        },
      },
      business: { select: { displayName: true, trn: true } },
    },
  });

  if (!invoice || invoice.businessId !== businessId) return null;
  // A draft has no number a seller should quote and no supply to evidence. `3m`
  // does not list one either.
  if (invoice.status === "draft") return null;

  const totals = storedTotals(invoice);
  const money = (fils: number) => formatAED(fils / FILS_PER_AED, { style: "quote" });
  const decimal = (value: unknown) =>
    value === null || value === undefined
      ? null
      : formatAED(Number(value), { style: "quote" });

  const lines: DocumentLine[] = invoice.lines.map((line) => ({
    id: line.id,
    description: line.description,
    detail: detailOf(line),
    bookingRef: line.bookingRef,
    qty: String(line.qty),
    /*
       The unit price, where it was stored.

       Falling back to the line amount would be right only while every quantity
       is one, and wrong silently the first time it is not. A null renders as a
       dash: the document says what it holds.
    */
    unitAed: decimal(line.unitAed),
    rate: line.vatRate === null ? null : `${(Number(line.vatRate) * 100).toFixed(0)}%`,
    vatAed: decimal(line.vatAed),
    amountAed: decimal(line.amountAed) ?? "0.00",
  }));

  return {
    id: invoice.id,
    ref: invoice.ref,
    docType: invoice.docType,
    status: invoice.status,
    supplier: {
      // The snapshot, not the constant. An invoice issued before the entity was
      // restated keeps the entity that issued it.
      name: invoice.supplierName ?? "",
      addressLines: (invoice.supplierAddress ?? "").split("\n").filter(Boolean),
      trn: null,
      incorporation: invoice.supplierIncorporation,
    },
    recipient: {
      name: invoice.billedToName ?? invoice.business.displayName,
      addressLines: (invoice.billedToAddress ?? "").split("\n").filter(Boolean),
      trn: invoice.billedToTrn ? formatTRN(invoice.billedToTrn) : null,
      incorporation: null,
    },
    issuedOn: invoice.issuedAt ? formatDate(invoice.issuedAt) : "",
    suppliedOn: invoice.supplyDate ? formatDate(invoice.supplyDate) : null,
    supplyPeriod: periodOf(invoice.lines),
    placeOfSupply: invoice.placeOfSupply,
    lines,
    totals: {
      subtotalAed: money(totals.subtotalFils),
      vatAed: money(totals.vatFils),
      totalAed: money(totals.totalFils),
      stored: totals.stored,
      currency: invoice.currency,
    },
    payment: invoice.paidAt
      ? {
          paidOn: formatDate(invoice.paidAt),
          brand: invoice.paidByBrand,
          last4: invoice.paidByLast4,
          bank: invoice.paidByBrand,
        }
      : null,
    references: { pspRef: invoice.pspRef, subscriptionRef: invoice.subscriptionRef },
    correctsRef: invoice.corrects?.ref ?? null,
    pdf:
      invoice.pdfPath && invoice.pdfBytes !== null
        ? { path: invoice.pdfPath, bytes: invoice.pdfBytes }
        : null,
    delivery: invoice.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      who:
        event.recipient ??
        event.actor?.fullName ??
        event.actor?.email ??
        "",
      when: formatDate(event.createdAt),
    })),
    billingEmail: await billingRecipient(businessId),
  };
}

/**
 * Where an invoice is emailed by default.
 *
 * Board 7e's setting first. Null there is the ordinary state rather than a gap,
 * so it falls to the **finance seat** — the role that exists so the owner does
 * not have to hold the card, which makes it the seat whose job invoices are —
 * and to the owner after that.
 *
 * Returns null only for a business with no seats at all, which is an imported
 * licence record nobody has claimed. The screen then offers no send rather than
 * a button addressed to nowhere.
 */
export async function billingRecipient(businessId: string): Promise<string | null> {
  const [preference, finance, owner] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: { businessId },
      select: { billingEmail: true },
    }),
    prisma.user.findFirst({
      where: { businessId, roles: { has: "seller_finance" } },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    }),
    prisma.user.findFirst({
      where: { businessId, roles: { has: "seller_owner" } },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    }),
  ]);

  return preference?.billingEmail ?? finance?.email ?? owner?.email ?? null;
}

/** `14 Aug – 13 Sep 2026 · standard rate`, or whichever half exists. */
function detailOf(line: {
  taxTreatment: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}): string {
  const treatment = RATE_LABEL[line.taxTreatment] ?? RATE_LABEL["standard"] ?? "";
  if (!line.periodStart || !line.periodEnd) return treatment;
  return `${formatDate(line.periodStart)} – ${formatDate(line.periodEnd)} · ${treatment}`;
}

/**
 * The supply period in the header, summarised from the lines.
 *
 * Earliest start to latest end, and **null when the lines disagree about
 * nothing** — that is, when no line carries a period at all. A header period
 * spanning two lines with different terms would be a fourth date claiming to
 * summarise two others, which is the failure the board's single `14 AUG 2026`
 * already made once.
 */
function periodOf(lines: readonly { periodStart: Date | null; periodEnd: Date | null }[]): string | null {
  const starts = lines.map((line) => line.periodStart).filter((d): d is Date => d !== null);
  const ends = lines.map((line) => line.periodEnd).filter((d): d is Date => d !== null);
  if (starts.length === 0 || ends.length === 0) return null;

  const from = new Date(Math.min(...starts.map((d) => d.getTime())));
  const to = new Date(Math.max(...ends.map((d) => d.getTime())));
  return `${formatDate(from)} – ${formatDate(to)}`;
}
