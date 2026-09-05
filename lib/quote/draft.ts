import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { parseAedToFils } from "@/lib/quote/money";
import { DEFAULT_VALIDITY_DAYS, VALIDITY_CHOICES } from "@/lib/quote/send-quote";

/**
 * Board 3j §5 — "line edits autosave as a draft. Send quote is the only commit."
 *
 * ## The status that had no writer
 *
 * `QuoteStatus.draft` has existed since the init migration. Nothing has ever
 * written it: `sendQuoteForBusiness` creates rows at `sent`, and the only other
 * transitions are the buyer's acceptance. So a seller who priced eleven lines,
 * took a call and closed the tab lost eleven prices — on the one screen in the
 * product where they type money, and against a design system whose rule is that
 * autosave is the dashboard default.
 *
 * ## A draft is the next revision, not a parallel row
 *
 * `Quote` is unique on `(enquiryId, businessId, revision)`, so a draft holds the
 * revision number it will be sent as, and sending *promotes the same row* rather
 * than creating a second one beside it. The alternative — a draft in its own row
 * at the same revision — cannot exist, and a draft at a made-up revision number
 * leaves a hole in the sequence the buyer sees.
 *
 * That is why `sendQuoteForBusiness` looks for a draft before creating: it is
 * the same quote, finished.
 *
 * ## What a draft deliberately does not do
 *
 * It does not stamp `firstReplyAt` (§2: "a saved draft does not"), does not
 * change `EnquiryRecipient.state`, does not notify, and does not appear on the
 * buyer's side — every buyer query filters `status: { not: "draft" }`. A seller
 * halfway through pricing has not replied to anything, and response time is
 * measured rather than claimed.
 */

export interface DraftLineInput {
  enquiryLineId: string;
  productId: string | null;
  description: string;
  qty: number;
  /** As typed. An empty string is a line the seller has not got to yet. */
  unitPrice: string;
  leadTimeDays: number | null;
}

export interface SaveDraftInput {
  enquiryId: string;
  note: string;
  validityDays: number;
  lines: DraftLineInput[];
}

export type SaveDraftResult =
  | { ok: true; savedAt: Date; lines: number }
  | { ok: false; error: "not_your_enquiry" | "decided" };

/**
 * Where a draft's revision number comes from.
 *
 * Sent quotes decide it; the draft takes the next one and holds it. Exported so
 * `sendQuoteForBusiness` computes the same number from the same rule rather than
 * its own copy of it.
 */
export async function nextRevisionFor(enquiryId: string, businessId: string): Promise<number> {
  const previous = await prisma.quote.findFirst({
    where: { enquiryId, businessId, status: { not: "draft" } },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  return (previous?.revision ?? 0) + 1;
}

/** The draft in progress, if there is one. */
export async function findDraft(enquiryId: string, businessId: string) {
  return prisma.quote.findFirst({
    where: { enquiryId, businessId, status: "draft" },
    select: {
      id: true,
      revision: true,
      note: true,
      validityDays: true,
      updatedAt: true,
      lines: {
        orderBy: { sortOrder: "asc" },
        select: {
          enquiryLineId: true,
          productId: true,
          description: true,
          qty: true,
          unitPrice: true,
          leadTimeDays: true,
        },
      },
    },
  });
}

/**
 * Save what is typed so far.
 *
 * Tolerant on purpose, and that is the difference between this and
 * `sendQuoteForBusiness`. Sending validates every line and refuses the whole
 * quote over one bad price, because a buyer is about to read it. A draft is the
 * seller's own workings: a half-typed number, a line with no price yet, a
 * quantity being edited. Refusing to save those is refusing to save exactly the
 * state autosave exists for.
 *
 * So a line the seller has not priced yet is simply left out, rather than saved
 * at zero — see the comment on the filter below. `Send quote` is where the
 * refusal lives, because that is where a buyer is about to read it.
 */
export async function saveDraft(
  actor: Actor,
  businessId: string,
  input: SaveDraftInput,
): Promise<SaveDraftResult> {
  assertCan(actor, "quote.send");

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    select: { outcome: true },
  });
  if (!recipient) return { ok: false, error: "not_your_enquiry" };
  // §7: a marked outcome makes the composer read-only. Autosave must not be the
  // way around a rule the buttons enforce.
  if (recipient.outcome) return { ok: false, error: "decided" };

  const validityDays = VALIDITY_CHOICES.includes(input.validityDays as (typeof VALIDITY_CHOICES)[number])
    ? input.validityDays
    : DEFAULT_VALIDITY_DAYS;

  /*
     Only the lines that carry a price.

     `QuoteLine.unitPrice` is `Decimal NOT NULL`, so an unpriced line has nothing
     to store — and storing zero would be worse than storing nothing, because
     `sendQuoteForBusiness` deliberately allows a zero line for a sample or an
     absorbed freight charge. A draft that came back reading `0.00` in every box
     the seller had not reached is the "never silently blank" defect inverted:
     the seller would send prices they never typed.

     So an unpriced line is simply absent, and the composer restores it empty —
     which is the same state the seller left it in.
  */
  const lines = input.lines
    .filter((line) => priceOf(line.unitPrice) !== null)
    .map((line, i) => ({
      productId: line.productId,
      description: line.description,
      qty: Number.isInteger(line.qty) && line.qty > 0 ? line.qty : 1,
      unitPrice: priceOf(line.unitPrice) as string,
      leadTimeDays: line.leadTimeDays,
      sortOrder: i,
      // Which enquiry line this was, so a reload puts it back on the right row.
      // Without it a draft with three of eight lines priced restores in order
      // rather than in place.
      enquiryLineId: line.enquiryLineId,
    }));

  const now = new Date();
  const existing = await findDraft(input.enquiryId, businessId);

  if (existing) {
    await prisma.$transaction([
      prisma.quoteLine.deleteMany({ where: { quoteId: existing.id } }),
      prisma.quote.update({
        where: { id: existing.id },
        data: {
          note: input.note || null,
          validityDays,
          updatedAt: now,
          lines: { create: lines },
        },
      }),
    ]);
    return { ok: true, savedAt: now, lines: lines.length };
  }

  const revision = await nextRevisionFor(input.enquiryId, businessId);

  await prisma.quote.create({
    data: {
      // A draft has no reference yet. `ref` is unique and a buyer never sees
      // this row, so it carries a private placeholder that `sendQuoteForBusiness`
      // replaces with the real one at the moment it becomes a quote.
      ref: draftRef(input.enquiryId, businessId, revision),
      enquiryId: input.enquiryId,
      businessId,
      revision,
      validityDays,
      note: input.note || null,
      status: "draft",
      lines: { create: lines },
    },
  });

  return { ok: true, savedAt: now, lines: lines.length };
}

/** Throw the working away. The seller's own decision, never an automatic one. */
export async function discardDraft(
  actor: Actor,
  businessId: string,
  enquiryId: string,
): Promise<void> {
  assertCan(actor, "quote.send");
  await prisma.quote.deleteMany({ where: { enquiryId, businessId, status: "draft" } });
}

/**
 * The typed price, if it is one yet.
 *
 * Null for an empty box and for a half-typed number — `"12."` on its way to
 * `"12.50"` is not a price, and a draft is saved while somebody is still
 * typing. The line is then left out entirely rather than stored at zero.
 */
function priceOf(typed: string): string | null {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  try {
    parseAedToFils(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

function draftRef(enquiryId: string, businessId: string, revision: number): string {
  return `DRAFT-${enquiryId.slice(-8)}-${businessId.slice(-6)}-R${revision}`;
}
