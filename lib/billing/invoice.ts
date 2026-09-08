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
 * ## What is not frozen
 *
 * The issuer — us. `BL Directory FZ-LLC`, the DMCC address, our TRN. A tax
 * invoice must carry the supplier's details, but ours are a fact about this
 * company rather than about the transaction, and if they ever change it is
 * because the company changed and every document should say so. They are
 * constants in `ISSUER` below rather than columns.
 */

/**
 * Us, on every document we issue.
 *
 * A constant rather than a setting: there is one issuer, it is this company,
 * and a settings row for it would be a field somebody could get wrong on a legal
 * document. `3m`'s header prints the TRN in the chrome and `11g` prints the
 * block; both read this.
 */
export const ISSUER = {
  name: "BL Directory FZ-LLC",
  addressLines: ["DMCC, Dubai, UAE"],
  trn: "100 4471 2200 0003",
} as const;

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
      paidByBrand: input.paidBy?.brand ?? null,
      paidByLast4: input.paidBy?.last4 ?? null,
      correctsId: input.correctsId ?? null,
      lines: {
        create: input.lines.map((line) => ({
          kind: line.kind,
          description: line.description,
          qty: line.qty ?? 1,
          amountAed: filsToAed(line.fils),
          periodStart: line.periodStart ?? null,
          periodEnd: line.periodEnd ?? null,
        })),
      },
    },
    select: { id: true, ref: true },
  });

  return { ...invoice, subtotalFils, vatFils, totalFils: subtotalFils + vatFils };
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
