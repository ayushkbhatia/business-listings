import type { Prisma } from "@/lib/db/generated/client";
import { isVerified } from "@/lib/verification";
import { commitmentFils } from "./value";

/**
 * Board `1o` D5 — a split, as the company's rule sees it.
 *
 * One supplier's share is a part: their quote, the buyer's lines taken from it
 * (null for the whole quote), and the PO number the buyer issues to them. The
 * rule is checked once, on the parts together: their combined value excl. VAT,
 * and verified only if every supplier is.
 *
 * `QuoteApproval.split` stores the parts of a request, so what was asked is what
 * gets approved — the request trigger refuses any change to it once asked.
 */
export interface AskPart {
  quoteId: string;
  /** The buyer's lines taken from this quote, sorted. Null: the whole quote. */
  enquiryLineIds: string[] | null;
  /** Issued to this supplier alone. */
  poNumber: string | null;
}

/** A part as `QuoteApproval.split` stores it, with the revision it was asked against. */
export interface StoredPart extends AskPart {
  quoteRevision: number;
}

/** The same parts, in one order, with each line list sorted — so two askings of one split compare equal. */
export function normaliseParts<P extends AskPart>(parts: readonly P[]): P[] {
  return [...parts]
    .map((part) => ({ ...part, enquiryLineIds: part.enquiryLineIds ? [...part.enquiryLineIds].sort() : null }))
    .sort((a, b) => a.quoteId.localeCompare(b.quoteId));
}

/** Whether two splits ask for the same lines from the same quotes. POs are compared separately. */
export function sameParts(a: readonly AskPart[], b: readonly AskPart[]): boolean {
  if (a.length !== b.length) return false;
  const left = normaliseParts(a);
  const right = normaliseParts(b);
  return left.every((part, index) => {
    const other = right[index]!;
    if (part.quoteId !== other.quoteId) return false;
    if (part.enquiryLineIds === null || other.enquiryLineIds === null) return part.enquiryLineIds === other.enquiryLineIds;
    return part.enquiryLineIds.join(",") === other.enquiryLineIds.join(",");
  });
}

/** What `QuoteApproval.split` holds. JSON, so each line list is an array of strings. */
export function splitJson(parts: readonly StoredPart[]): Prisma.InputJsonValue {
  return normaliseParts(parts).map((part) => ({
    quoteId: part.quoteId,
    quoteRevision: part.quoteRevision,
    enquiryLineIds: part.enquiryLineIds,
    poNumber: part.poNumber,
  }));
}

/** Read `QuoteApproval.split` back. Null for a single-quote request, or for a value that is not a split. */
export function readSplit(value: Prisma.JsonValue | null | undefined): StoredPart[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts: StoredPart[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { quoteId, quoteRevision, enquiryLineIds, poNumber } = entry as Record<string, unknown>;
    if (typeof quoteId !== "string" || typeof quoteRevision !== "number") return null;
    if (enquiryLineIds !== null && !(Array.isArray(enquiryLineIds) && enquiryLineIds.every((id) => typeof id === "string"))) {
      return null;
    }
    if (poNumber !== null && typeof poNumber !== "string") return null;
    parts.push({ quoteId, quoteRevision, enquiryLineIds: enquiryLineIds as string[] | null, poNumber: poNumber as string | null });
  }
  return parts;
}

/**
 * The rule's input for a split: the parts' combined value excl. VAT, and
 * whether every supplier is verified.
 *
 * A part's value is its chosen lines plus the lines the supplier added (D7),
 * which go with any accepted part. Null when any part has no single total — a
 * proposal, which a split never includes, but the arithmetic says so rather
 * than assuming it.
 */
export async function splitAsk(
  db: Prisma.TransactionClient,
  parts: readonly AskPart[],
): Promise<{ valueFils: bigint | null; supplierVerified: boolean } | null> {
  const quotes = await db.quote.findMany({
    where: { id: { in: parts.map((part) => part.quoteId) } },
    select: {
      id: true,
      lines: { select: { enquiryLineId: true, qty: true, unitPrice: true } },
      proposal: { select: { feeBasis: true, feeAed: true, mobilisationAed: true } },
      business: { select: { verificationTier: true } },
    },
    orderBy: { id: "asc" },
  });
  if (quotes.length !== parts.length) return null;

  let valueFils: bigint | null = 0n;
  let supplierVerified = true;
  for (const part of parts) {
    const quote = quotes.find((row) => row.id === part.quoteId)!;
    supplierVerified &&= isVerified(quote.business.verificationTier);
    const taken = part.enquiryLineIds ? new Set(part.enquiryLineIds) : null;
    const lines = quote.lines.filter((line) => !taken || line.enquiryLineId === null || taken.has(line.enquiryLineId));
    const value = commitmentFils({
      lines: lines.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() })),
      proposal: quote.proposal
        ? {
            feeBasis: quote.proposal.feeBasis,
            feeAed: quote.proposal.feeAed?.toString() ?? null,
            mobilisationAed: quote.proposal.mobilisationAed?.toString() ?? null,
          }
        : null,
    });
    valueFils = value === null || valueFils === null ? null : valueFils + value;
  }
  return { valueFils, supplierVerified };
}
