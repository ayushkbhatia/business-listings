import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { FILS_PER_AED, VAT_RATE, filsToAed, vatOn } from "./proration";

/**
 * Issuing an invoice, and reading one back without changing it.
 *
 * Board 3m, criteria 1 and 2: *"One invoice has one total everywhere it
 * appears"* and *"invoice rows render stored values and never recompute them."*
 * The two are the same requirement seen from either end, and the pair of boards
 * exists because it was broken at the design layer first — `BL-INV-20418` read
 * `AED 7,802.15` on `3m` and `AED 1,783.95` on `11f`.
 *
 * ## What is frozen, and why each one
 *
 * **The totals.** `invoiceList` and `vatReturn` each summed `InvoiceLine` and
 * applied the rate themselves. Two readers, one invoice, and no guarantee they
 * agreed with each other or with what the card was actually charged. Now the
 * three figures are written once, at issue, and every reader reads them.
 *
 * **The billed party.** Name, address and TRN were read live from `Business`,
 * so a supplier who renamed rewrote their own invoice history. A tax invoice
 * records a supply made to a party as they were on the day; it is not a view
 * over the customer table. Criterion 14 wants the TRN in full wherever invoices
 * are referenced, and the TRN it wants is the one that was true then.
 *
 * **The rate.** `Invoice.vatRate` already existed and is already read line by
 * line by the VAT return. Nothing here changes that; it is named because it is
 * the third thing that must not move.
 *
 * **The issuer — us.** This was a constant, on the reasoning that our own
 * details are a fact about this company rather than about the transaction. That
 * reasoning did not survive board 11g, and it did not survive it in the most
 * direct way possible: the issuing entity changed. `BL Directory FZ-LLC` in
 * DMCC, with a TRN, became **Bearing Deployment Company, Inc** — Delaware,
 * San Francisco, **no TRN at all**. A constant would have rewritten the supplier
 * on every invoice ever issued, retrospectively, including ones a seller had
 * already filed with their accountant.
 *
 * So `ISSUER` is now only the default for a *new* invoice. Every issued one
 * carries its own `supplierName` / `supplierAddress` / `supplierIncorporation`,
 * and the renderer reads those.
 */

/**
 * Us, as of today — the default stamped onto a **new** invoice.
 *
 * Not what an existing invoice renders: that reads its own stored snapshot. The
 * distinction is the whole of board 11g's third correction, and this entity is
 * the proof, because it has already changed once.
 *
 * **No TRN.** Bearing Deployment Company is incorporated in Delaware and is not
 * registered in the UAE, so there is no supplier tax number — and its absence is
 * deliberate rather than missing data. With one tax number on the page an
 * unlabelled one reads as the issuer's, which is why the recipient's is labelled
 * `Recipient TRN` on the document.
 *
 * That leaves a US-registered supplier charging 5% on a document headed
 * `TAX INVOICE`, which is spec Q3 and is a question for a tax advisor rather
 * than a design decision. `STATUTORY_NOTE_PENDING` below is how the document
 * says so out loud instead of inventing wording.
 */
export const ISSUER = {
  name: "Bearing Deployment Company, Inc",
  addressLines: ["2261 Market Street STE 83655", "San Francisco CA 94114"],
  incorporation: "Incorporated in Delaware, USA",
} as const;

/**
 * The statutory sentence, held open.
 *
 * Board 11g renders a visibly marked dashed box where the VAT wording belongs,
 * rather than inventing a sentence — because who accounts for 5% charged by a
 * US supplier to a UAE recipient changes the heading, the footnote and possibly
 * the VAT lines themselves.
 *
 * A placeholder that is *visible* is the point. A silently absent footnote looks
 * like a finished document; this one tells anyone reading it, including the tax
 * advisor, exactly which question is still open.
 */
export const STATUTORY_NOTE_PENDING = true;

/** `BL-INV-20418`. The board's format, and the seller's reference on a bank line. */
const REF_PREFIX = "BL-INV-";

/**
 * The next invoice reference.
 *
 * A Postgres sequence rather than `count() + 1`, because two invoices issued in
 * the same second must not collide — and `ref` is `@unique`, so a collision is a
 * failed charge that already took the money. `nextval` is transactional in the
 * sense that matters here: it never returns the same number twice, even to
 * concurrent transactions, and a rolled-back transaction burning a number leaves
 * a gap rather than a duplicate. A gap in an invoice sequence is a question an
 * accountant can answer; a repeat is not.
 */
export async function nextInvoiceRef(tx: Prisma.TransactionClient = prisma): Promise<string> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_ref_seq') AS n`;
  return `${REF_PREFIX}${String(row?.n ?? 0)}`;
}

export interface InvoiceLineInput {
  kind: "subscription" | "placement" | "subscription_credit";
  description: string;
  /** Whole fils, signed. A credit is negative and stays negative. */
  fils: number;
  qty?: number;
  /** What this line covers, where it covers a period. See the schema note. */
  periodStart?: Date | null;
  periodEnd?: Date | null;
  /**
   * How this line is treated for VAT. Board 11g.
   *
   * Defaults to `standard`, which is every line we sell today. It is stored per
   * line anyway: the first zero-rated or out-of-scope line has nowhere to go in
   * a blended `VAT 5%` row, and a document's layout cannot change after issue.
   */
  taxTreatment?: "standard" | "zero_rated" | "exempt" | "out_of_scope";
  /** The placement booking this line bills. Printed as text — `11e` has no page. */
  bookingRef?: string | null;
}

export interface IssueInvoiceInput {
  businessId: string;
  lines: readonly InvoiceLineInput[];
  issuedAt: Date;
  /** Set when the charge has already succeeded. `issued` otherwise. */
  paidAt?: Date | null;
  /** Brand and last four of whatever paid it. Criterion 13. */
  paidBy?: { brand: string; last4: string } | null;
  /** Defaults to `VAT_RATE`. Stamped on the row and never re-read from here. */
  vatRate?: number;
  /** Set on a credit note. The document this one corrects. */
  correctsId?: string | null;
  docType?: "tax_invoice" | "credit_note";
  /** Our own reference for the provider transaction, where there was one. */
  ref?: string;
  /**
   * Date of supply, where it differs from the date of issue.
   *
   * Board 11g: the board printed one date and let it stand for issue, supply and
   * the supply period at once. Defaults to `issuedAt`, which is true of a
   * subscription charged on the day its period opens, and is stated separately
   * so the document does not have to imply it.
   */
  supplyDate?: Date | null;
  /** `Dubai, UAE`. Where the supply is made, stored as a fact about the day. */
  placeOfSupply?: string | null;
  /** The provider's reference, printed under REFERENCES. */
  pspRef?: string | null;
  /** Ours — `SUB-4471-PRO`. */
  subscriptionRef?: string | null;
}

export interface IssuedInvoice {
  id: string;
  ref: string;
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
}

/**
 * Write an invoice, with its totals, and never touch it again.
 *
 * The party snapshot is read inside the same transaction as the write, so an
 * invoice cannot be issued against a business that was renamed between the two.
 *
 * Refuses an invoice with no lines. A zero-line invoice has a total of nothing
 * and still occupies a reference number, which is a document an accountant will
 * ask about and nobody can explain — board 3m's ninth correction is the same
 * shape, a `Sponsored placement · AED 0.00` line sitting under a real one.
 */
export async function issueInvoice(
  input: IssueInvoiceInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<IssuedInvoice> {
  if (input.lines.length === 0) {
    throw new Error("An invoice with no lines is a reference number with nothing behind it.");
  }

  const business = await tx.business.findUniqueOrThrow({
    where: { id: input.businessId },
    select: {
      displayName: true,
      trn: true,
      locations: {
        where: { type: "head_office" },
        take: 1,
        select: { addressLine: true, area: { select: { name: true } }, emirate: true },
      },
    },
  });

  const vatRate = input.vatRate ?? VAT_RATE;
  const subtotalFils = input.lines.reduce((sum, line) => sum + line.fils * (line.qty ?? 1), 0);
  const vatFils = vatOn(subtotalFils, vatRate);
  const ref = input.ref ?? (await nextInvoiceRef(tx));

  /*
     VAT per line, and the document total is the sum of them.

     `vatFils` above rounds once over the whole invoice, which is the convention
     `vatReturn` already applied and what the seller's copy has always shown. The
     per-line figures have to add up to it or the document contradicts its own
     total, so the last line absorbs whatever the per-line rounding left over —
     at most one fil, and on the line rather than in a footnote.
  */
  const lineVat = input.lines.map((line) => {
    const rate = line.taxTreatment && line.taxTreatment !== "standard" ? 0 : vatRate;
    return { rate, fils: vatOn(line.fils * (line.qty ?? 1), rate) };
  });
  const lineVatSum = lineVat.reduce((sum, line) => sum + line.fils, 0);
  const lastVat = lineVat[lineVat.length - 1];
  if (lastVat && lineVatSum !== vatFils) lastVat.fils += vatFils - lineVatSum;

  const invoice = await tx.invoice.create({
    data: {
      ref,
      businessId: input.businessId,
      docType: input.docType ?? "tax_invoice",
      vatRate: new Prisma.Decimal(vatRate),
      status: input.paidAt ? "paid" : "issued",
      issuedAt: input.issuedAt,
      paidAt: input.paidAt ?? null,
      subtotalFils,
      vatFils,
      totalFils: subtotalFils + vatFils,
      billedToName: business.displayName,
      billedToTrn: business.trn,
      billedToAddress: addressOf(business.locations[0] ?? null),
      /*
         Us, frozen. Board 11g's third correction, and this entity is its own
         proof: the issuer was a UAE company with a TRN when the board was drawn
         and is now a Delaware one with none. Reading `ISSUER` at render time
         would have restated the supplier on every invoice ever sent.
      */
      supplierName: ISSUER.name,
      supplierAddress: ISSUER.addressLines.join("\n"),
      supplierIncorporation: ISSUER.incorporation,
      // Three dates, separately stated. The board printed one.
      supplyDate: input.supplyDate ?? input.issuedAt,
      placeOfSupply: input.placeOfSupply ?? placeOf(business.locations[0] ?? null),
      pspRef: input.pspRef ?? null,
      subscriptionRef: input.subscriptionRef ?? null,
      paidByBrand: input.paidBy?.brand ?? null,
      paidByLast4: input.paidBy?.last4 ?? null,
      correctsId: input.correctsId ?? null,
      lines: {
        create: input.lines.map((line, index) => ({
          kind: line.kind,
          description: line.description,
          qty: line.qty ?? 1,
          amountAed: filsToAed(line.fils),
          periodStart: line.periodStart ?? null,
          periodEnd: line.periodEnd ?? null,
          unitAed: filsToAed(line.fils),
          vatRate: new Prisma.Decimal(lineVat[index]?.rate ?? vatRate),
          vatAed: filsToAed(lineVat[index]?.fils ?? 0),
          taxTreatment: line.taxTreatment ?? "standard",
          bookingRef: line.bookingRef ?? null,
        })),
      },
    },
    select: { id: true, ref: true },
  });

  return { ...invoice, subtotalFils, vatFils, totalFils: subtotalFils + vatFils };
}

/** `Dubai, UAE` — where the supply is made, from the seller's head office. */
function placeOf(location: { emirate: string } | null): string | null {
  return location ? `${emirateName(location.emirate)}, UAE` : null;
}

/**
 * One address line, as it prints on the document. Null where there is none.
 *
 * A seller with no head office is not an error here — an imported licence record
 * has no location at all until somebody claims it, and refusing to invoice would
 * be the wrong end to enforce that from. The document then carries the name and
 * the TRN and no street, which is what we know.
 */
function addressOf(
  location: { addressLine: string; area: { name: string }; emirate: string } | null,
): string | null {
  if (!location) return null;
  const written = [location.addressLine, location.area.name, emirateName(location.emirate)].filter(
    (part) => part.length > 0,
  );
  return written.length > 0 ? written.join(", ") : null;
}

/** `abu_dhabi` reads as `Abu Dhabi` on a document somebody files. */
function emirateName(emirate: string): string {
  return emirate
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface StoredTotals {
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
  /**
   * False when the figures were derived from the lines because the invoice
   * predates the stored columns.
   *
   * Every caller that renders money reads this, and the ones that can say so do:
   * a derived total is today's arithmetic over yesterday's lines, which is
   * exactly what criterion 2 stops trusting. It is not an error — it is what an
   * invoice issued before this migration honestly is.
   */
  stored: boolean;
}

export interface TotallableInvoice {
  subtotalFils: number | null;
  vatFils: number | null;
  totalFils: number | null;
  vatRate: Prisma.Decimal | number | string;
  lines: readonly { amountAed: Prisma.Decimal | number | string; qty: number }[];
}

/**
 * The totals, stored where there are stored ones.
 *
 * The one reader. Nothing else in the codebase may sum `InvoiceLine` and apply
 * a rate — `invoiceList`, `vatReturn`, the seller's list and the document all
 * come through here, so criterion 1 holds by construction rather than by four
 * places happening to agree.
 */
export function storedTotals(invoice: TotallableInvoice): StoredTotals {
  if (
    invoice.subtotalFils !== null &&
    invoice.vatFils !== null &&
    invoice.totalFils !== null
  ) {
    return {
      subtotalFils: invoice.subtotalFils,
      vatFils: invoice.vatFils,
      totalFils: invoice.totalFils,
      stored: true,
    };
  }

  const subtotalFils = invoice.lines.reduce(
    (sum, line) => sum + Math.round(Number(line.amountAed) * FILS_PER_AED) * line.qty,
    0,
  );
  const vatFils = vatOn(subtotalFils, Number(invoice.vatRate));
  return { subtotalFils, vatFils, totalFils: subtotalFils + vatFils, stored: false };
}

/**
 * A credit note against an issued invoice.
 *
 * Q5: UAE VAT requires one for any correction, and an issued invoice may not be
 * edited. It is the same table and the same list — a negative total pointing at
 * the document it corrects — because that is what it is on the seller's screen
 * and in the VAT return, where it reduces output VAT.
 *
 * Refuses a second note against the same invoice, and refuses one for more than
 * the invoice was. Both are the same mistake seen twice: a correction that
 * exceeds what was charged is not a correction.
 */
export type CreditNoteResult =
  | { ok: true; invoice: IssuedInvoice }
  | { ok: false; error: "not_found" | "not_issued" | "already_corrected" | "too_large" };

export async function creditNoteFor(
  invoiceId: string,
  reason: string,
  now: Date,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditNoteResult> {
  const original = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      businessId: true,
      status: true,
      docType: true,
      vatRate: true,
      subtotalFils: true,
      vatFils: true,
      totalFils: true,
      lines: { select: { amountAed: true, qty: true } },
      correctedBy: { select: { id: true }, take: 1 },
    },
  });

  if (!original || original.docType !== "tax_invoice") return { ok: false, error: "not_found" };
  if (original.status === "draft" || original.status === "void") {
    return { ok: false, error: "not_issued" };
  }
  if (original.correctedBy.length > 0) return { ok: false, error: "already_corrected" };

  const totals = storedTotals(original);
  if (totals.subtotalFils <= 0) return { ok: false, error: "too_large" };

  const invoice = await issueInvoice(
    {
      businessId: original.businessId,
      docType: "credit_note",
      correctsId: original.id,
      issuedAt: now,
      vatRate: Number(original.vatRate),
      lines: [{ kind: "subscription_credit", description: reason, fils: -totals.subtotalFils }],
    },
    tx,
  );

  return { ok: true, invoice };
}
