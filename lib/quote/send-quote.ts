import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { parseAedToFils } from "@/lib/quote/money";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { onQuoteSent } from "@/lib/notify/events";
import { findDraft, nextRevisionFor } from "./draft";

/**
 * Sending a quote — the service.
 *
 * Separate from the server action on purpose. The action's job is to resolve
 * who is acting and to revalidate; this is the part with the invariants, and it
 * takes an actor and a business id rather than reading cookies, so it can be
 * tested against a real database without a request.
 *
 * What it writes, and nothing else: a Quote, its QuoteLines, and the recipient
 * row's state and first-reply timestamp. No order, no fulfilment, no payment —
 * see CLAUDE.md. If a future task here seems to need one, the task is wrong.
 */

export interface SendQuoteLineInput {
  enquiryLineId: string;
  productId: string | null;
  description: string;
  qty: number;
  unitPrice: string;
  leadTimeDays: number | null;
}

export interface SendQuoteInput {
  enquiryId: string;
  note: string;
  validityDays: number;
  lines: SendQuoteLineInput[];
}

export type SendQuoteResult =
  | { ok: true; quoteId: string; quoteRef: string; revision: number }
  | { ok: false; error: string };

/** Board 3k's picker. Anything else is coerced to the default rather than trusted. */
export const VALIDITY_CHOICES = [7, 10, 14, 21, 30, 45, 60] as const;
export const DEFAULT_VALIDITY_DAYS = 14;

export async function sendQuoteForBusiness(
  actor: Actor,
  businessId: string,
  input: SendQuoteInput,
): Promise<SendQuoteResult> {
  assertCan(actor, "quote.send");

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    select: { firstReplyAt: true },
  });
  // Not a recipient and no such enquiry give the same answer, so the endpoint
  // cannot be used to find out which enquiries exist.
  if (!recipient) return { ok: false, error: t("quote.error.not_your_enquiry") };

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: input.enquiryId },
    select: { closesAt: true, revision: true, lines: { select: { id: true } } },
  });
  if (!enquiry) return { ok: false, error: t("quote.error.not_your_enquiry") };

  const now = new Date();
  if (enquiry.closesAt.getTime() < now.getTime()) {
    return { ok: false, error: t("quote.error.closed", { when: formatDate(enquiry.closesAt) }) };
  }

  if (input.lines.length === 0) {
    return { ok: false, error: t("quote.error.nothing_included") };
  }

  // Every line must be a line of this enquiry. Without this a seller could
  // price something the buyer never asked for, and the buyer would have no way
  // to tell it apart from something they did.
  const enquiryLineIds = new Set(enquiry.lines.map((l) => l.id));
  if (input.lines.some((l) => !enquiryLineIds.has(l.enquiryLineId))) {
    return { ok: false, error: t("quote.error.line_not_on_enquiry") };
  }

  // Every named product must be this seller's own. A product id from another
  // catalogue would put a competitor's SKU on this quote.
  const productIds = [...new Set(input.lines.map((l) => l.productId).filter((id): id is string => id !== null))];
  if (productIds.length > 0) {
    const owned = await prisma.product.count({ where: { id: { in: productIds }, businessId } });
    if (owned !== productIds.length) {
      return { ok: false, error: t("quote.error.product_not_yours") };
    }
  }

  for (const line of input.lines) {
    let fils: bigint;
    try {
      fils = parseAedToFils(line.unitPrice);
    } catch {
      return { ok: false, error: t("quote.error.bad_price", { line: line.description }) };
    }
    /*
     * Zero is allowed — a sample, a goodwill line, a freight line absorbed.
     * Negative is not: the database rejects it too, and reaching that check
     * means a 500 where the seller should have got a sentence telling them what
     * a price looks like.
     */
    if (fils < 0n) {
      return { ok: false, error: t("quote.error.bad_price", { line: line.description }) };
    }
    if (!Number.isInteger(line.qty) || line.qty < 1) {
      return { ok: false, error: t("quote.error.bad_qty", { line: line.description }) };
    }
  }

  const validityDays = VALIDITY_CHOICES.includes(input.validityDays as (typeof VALIDITY_CHOICES)[number])
    ? input.validityDays
    : DEFAULT_VALIDITY_DAYS;

  /*
     A revision is a new row, never an edit. Board 10h shows the buyer both.

     The one row this may reuse is the seller's own unsent draft: board 3j
     autosaves line edits, and a draft *is* the next revision waiting to be
     finished rather than a second quote beside it. `Quote` is unique on
     (enquiryId, businessId, revision), so promoting it is the only shape that
     does not leave a hole in the sequence the buyer reads.
  */
  const draft = await findDraft(input.enquiryId, businessId);
  const revision = draft?.revision ?? (await nextRevisionFor(input.enquiryId, businessId));

  const expiresAt = new Date(now.getTime() + validityDays * 24 * 3_600_000);
  const ref = await nextQuoteRef(input.enquiryId, businessId, revision);

  const lineData = input.lines.map((line, i) => ({
    enquiryLineId: line.enquiryLineId,
    productId: line.productId,
    description: line.description,
    qty: line.qty,
    unitPrice: line.unitPrice,
    leadTimeDays: line.leadTimeDays,
    sortOrder: i,
  }));

  const sent = await prisma.$transaction(async (tx) => {
    if (draft) {
      // Promote. The draft's lines are replaced wholesale rather than merged:
      // what the seller is sending is what is on screen now, and a line they
      // removed must not survive in the quote a buyer receives.
      await tx.quoteLine.deleteMany({ where: { quoteId: draft.id } });
      const promoted = await tx.quote.update({
        where: { id: draft.id },
        data: {
          ref,
          againstRevision: enquiry.revision,
          validityDays,
          note: input.note || null,
          status: "sent",
          sentAt: now,
          expiresAt,
          lines: { create: lineData },
        },
        select: { id: true, ref: true, revision: true },
      });

      await tx.enquiryRecipient.update({
        where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
        data: {
          state: "quoted",
          ...(recipient.firstReplyAt === null ? { firstReplyAt: now } : {}),
        },
      });

      return {
        ok: true as const,
        quoteId: promoted.id,
        quoteRef: promoted.ref,
        revision: promoted.revision,
      };
    }

    const created = await tx.quote.create({
      data: {
        ref,
        enquiryId: input.enquiryId,
        businessId,
        revision,
        /*
           Which version of the requirement this was priced against.

           The column has existed since the revisions migration with a default of
           1 and no writer, so every quote in the database claimed to be priced
           against R1 whatever the buyer had since changed. The buyer's tracking
           page renders it — `QUOTED R1 · REQUIREMENT CHANGED SINCE` — so a
           supplier who had correctly re-priced against R3 was shown to the buyer
           as working from the original.
        */
        againstRevision: enquiry.revision,
        validityDays,
        note: input.note || null,
        status: "sent",
        sentAt: now,
        expiresAt,
        lines: { create: lineData },
      },
      select: { id: true, ref: true, revision: true },
    });

    await tx.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
      data: {
        state: "quoted",
        // Response time is measured, never claimed. This is the only place a
        // first reply is stamped, and it is stamped once.
        ...(recipient.firstReplyAt === null ? { firstReplyAt: now } : {}),
      },
    });

    return { ok: true as const, quoteId: created.id, quoteRef: created.ref, revision: created.revision };
  });

  // Outside the transaction: a carrier being slow must not hold one open.
  await onQuoteSent({ enquiryId: input.enquiryId, businessId, revision: sent.revision });

  return sent;
}

/**
 * `QT-8863-ALMR1`.
 *
 * The enquiry number so both parties can say it on the phone, the supplier's
 * three-letter mark because one enquiry carries up to eight quotes, and the
 * revision because a revision is a new row rather than an edit. A numeric
 * suffix is appended in the rare case two suppliers share a mark on the same
 * enquiry — the ref column is unique and a clash must not lose a quote.
 */
async function nextQuoteRef(enquiryId: string, businessId: string, revision: number): Promise<string> {
  const [enquiry, business] = await Promise.all([
    prisma.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, select: { ref: true } }),
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { slug: true } }),
  ]);

  const number = enquiry.ref.replace(/^ENQ-/, "");
  const mark = business.slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase() || "SUP";
  const base = `QT-${number}-${mark}R${revision}`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.quote.findUnique({ where: { ref: candidate }, select: { ref: true } });
    if (!taken) return candidate;
  }
  throw new Error(`Could not allocate a quote reference for ${base}`);
}
