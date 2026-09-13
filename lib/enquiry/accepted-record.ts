import type { Commitment } from "@/lib/quote/commitments";
import { filsToAed, lineTotalFils, quoteTotalFils } from "@/lib/quote/money";

/**
 * Board `7c` — the accepted quote record, as one value.
 *
 * *"This is one `Enquiry` in its terminal state, not a new entity."* (`B1`) There
 * is no `AcceptedRecord` table and there must never be one: this type is a read
 * of an `Enquiry`, its accepted `Quote`, and the supplier it released contact
 * to. The page, the quote PDF and the gallery all render the same value, so the
 * three cannot disagree about a figure (`B7`).
 *
 * Pure — types and the arithmetic, no database. The loader is
 * `lib/db/queries/accepted-record.ts`.
 */

/** The PDF header prints it on one line; the migration's CHECK holds the same number. */
export const BUYER_REFERENCE_MAX = 40;

/** Long enough to say what went wrong; the moderator has the thread for the rest. */
export const REPORT_DETAIL_MIN = 20;
export const REPORT_DETAIL_MAX = 2000;

export interface AcceptedRecordLine {
  id: string;
  description: string;
  /** Null where the line was priced as a whole. The cell says so rather than printing ×1. */
  qty: number | null;
  /** AED, two places, as quoted. */
  unitPrice: string;
  /** AED, computed from `qty × unitPrice` here. Never stored, never entered (`B2`). */
  lineTotal: string;
  leadTimeDays: number | null;
  /** The catalogue product's SKU, where the supplier priced one. */
  sku: string | null;
  /**
   * Priced by hand rather than from the supplier's catalogue (`B5`) — the
   * free-text line the buyer typed on `1h` that never matched a listing.
   */
  manual: boolean;
}

export type RecordReview =
  | { kind: "none" }
  | { kind: "posted"; postedAt: Date }
  | { kind: "held"; postedAt: Date }
  | { kind: "removed"; postedAt: Date };

export type RecordReport =
  | { kind: "none" }
  | { kind: "open"; filedAt: Date }
  | {
      kind: "resolved";
      filedAt: Date;
      outcome: "seller_corrected" | "upheld" | "no_action";
      reason: string;
      resolvedAt: Date;
    };

export interface RecordLocation {
  /** `LocationType`, worded by the page. */
  type: string;
  addressLine: string;
  areaName: string | null;
  emirate: string;
}

export interface AcceptedRecord {
  enquiryId: string;
  ref: string;
  /** The buyer's PO or job code. Null until they add one. */
  buyerReference: string | null;
  /** Null only on rows written before either stamp existed; the page then omits the date. */
  acceptedAt: Date | null;
  /** Board `1h-s`: a brief for work. The record renders, and says it is goods-shaped (Q4). */
  isBrief: boolean;
  /** Suppliers declined by this acceptance. Zero on a single-supplier enquiry, and then unsaid. */
  declinedCount: number;
  quote: {
    id: string;
    ref: string;
    revision: number;
    note: string | null;
    paymentTerms: string | null;
    delivery: string | null;
    validityDays: number;
    sentAt: Date | null;
    expiresAt: Date | null;
    lines: AcceptedRecordLine[];
    totalAed: string;
  };
  supplier: {
    id: string;
    slug: string;
    displayName: string;
    /**
     * A person who consented to be shown, where the supplier named one at this
     * location. `TeamMember` rows carry `consentGivenAt NOT NULL`; a seller
     * seat's own name and login phone are never released.
     */
    person: { name: string; role: string; phone: string | null } | null;
    phone: string | null;
    whatsapp: string | null;
    location: RecordLocation | null;
  };
  commitments: Commitment[];
  review: RecordReview;
  report: RecordReport;
}

/** The lines with their totals, and the sum. One implementation for page and PDF. */
export function recordLines(
  lines: readonly {
    id: string;
    description: string;
    qty: number | null;
    unitPrice: string;
    leadTimeDays: number | null;
    productId: string | null;
    sku: string | null;
  }[],
): { lines: AcceptedRecordLine[]; totalAed: string } {
  const out = lines.map((line) => ({
    id: line.id,
    description: line.description,
    qty: line.qty,
    unitPrice: line.unitPrice,
    lineTotal: filsToAed(lineTotalFils({ qty: line.qty, unitPrice: line.unitPrice })),
    leadTimeDays: line.leadTimeDays,
    sku: line.productId ? line.sku : null,
    manual: line.productId === null,
  }));
  return {
    lines: out,
    totalAed: filsToAed(quoteTotalFils(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })))),
  };
}

/**
 * Whether the price window has passed. *"The record stands; the price held line
 * reads as expired. The quote is history, not an offer."*
 */
export function windowExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/** The order a buyer would drive to: a head office after the branch that handled them. */
const TYPE_ORDER: Record<string, number> = {
  head_office: 0,
  warehouse: 1,
  trade_counter: 2,
  depot: 3,
  sales_office: 4,
  workshop: 5,
};

/**
 * Which published location the record names.
 *
 * The one that shipped read `locations[0]` from a query with **no `orderBy`**,
 * so a supplier with a Jebel Ali warehouse and a Sharjah trade counter showed
 * whichever Postgres returned first — a different address on a different day,
 * on a page that is supposed to be a record. Build plan step 3.4.
 *
 * Deterministic now: the branch of the seat the lead was routed to, because
 * that is who the buyer has been dealing with; then by type, head office first;
 * then the oldest, then the id, so a tie cannot move.
 */
export function chooseContactLocation<
  T extends { id: string; type: string; createdAt: Date },
>(locations: readonly T[], preferredId: string | null): T | null {
  if (locations.length === 0) return null;
  if (preferredId) {
    const preferred = locations.find((location) => location.id === preferredId);
    if (preferred) return preferred;
  }
  return (
    [...locations].sort(
      (a, b) =>
        (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}
