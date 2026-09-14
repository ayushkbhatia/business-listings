import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { parseAedToFils } from "@/lib/quote/money";
import { DEFAULT_VALIDITY_DAYS, VALIDITY_CHOICES } from "@/lib/quote/send-quote";
import { quoteFence, type QuoteFenceReason } from "./fence";
import { lockQuoteFence, readQuoteFence } from "./fence-server";
import { parseDeliveryTerms, parsePaymentTerms } from "./terms";
import { workEnquiryOf } from "./work-enquiry";

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
  /** Null where the buyer's line is work rather than a count of things. */
  qty: number | null;
  /** As typed. An empty string is a line the seller has not got to yet. */
  unitPrice: string;
  leadTimeDays: number | null;
}

export interface SaveDraftInput {
  enquiryId: string;
  note: string;
  validityDays: number;
  /** As chosen so far; anything that is not a value saves as *not stated*. */
  paymentTerms?: string | null;
  delivery?: string | null;
  lines: DraftLineInput[];
}

export type SaveDraftResult =
  | { ok: true; savedAt: Date; lines: number }
  | { ok: false; error: "not_your_enquiry" }
  /** Board `3j-s`: an enquiry for work is answered by a proposal, never by lines. */
  | { ok: false; error: "work_enquiry" }
  /** Board `7c`'s fence refused, for the same reason a send would have. */
  | { ok: false; error: "fenced"; reason: QuoteFenceReason; closesAt: Date }
  /**
   * Nothing written: a send took the revision this save was aiming at while it
   * waited for the lock. See `claimDraftSlot`. Not an error to show — the send
   * that won has already refreshed the lead, or refuses its own tab in words.
   */
  | { ok: false; error: "superseded" };

/**
 * Where a draft's revision number comes from.
 *
 * Sent quotes decide it; the draft takes the next one and holds it. Exported so
 * `sendQuoteForBusiness` and `sendProposal` compute the same number from the
 * same rule rather than their own copies of it.
 *
 * A send passes the transaction that holds the enquiry's row lock, and must: a
 * revision read before the lock is a guess two concurrent sends both make.
 */
export async function nextRevisionFor(
  enquiryId: string,
  businessId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<number> {
  const previous = await db.quote.findFirst({
    where: { enquiryId, businessId, status: { not: "draft" } },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  return (previous?.revision ?? 0) + 1;
}

/**
 * The draft row alone — which one and at what revision — through any client.
 *
 * Under the enquiry's lock there is at most one. Read before the lock, it is
 * only what the caller saw, and `claimDraftSlot` holds it to that.
 */
export async function draftIn(db: Prisma.TransactionClient, enquiryId: string, businessId: string) {
  return db.quote.findFirst({
    where: { enquiryId, businessId, status: "draft" },
    orderBy: [{ revision: "desc" }, { id: "asc" }],
    select: { id: true, revision: true },
  });
}

/** What an autosave saw before it took the lock: its draft, if any, and the revision it is writing. */
export interface DraftAim {
  draftId: string | null;
  revision: number;
}

export async function aimDraft(enquiryId: string, businessId: string): Promise<DraftAim> {
  const draft = await draftIn(prisma, enquiryId, businessId);
  return { draftId: draft?.id ?? null, revision: draft?.revision ?? (await nextRevisionFor(enquiryId, businessId)) };
}

export type DraftSlot = { kind: "update"; id: string } | { kind: "create"; revision: number } | { kind: "superseded" };

/**
 * Where an autosave may write, decided under the enquiry's row lock.
 *
 * Autosave once wrote with no lock, which a send takes. Two races followed. A
 * save creating the next revision's draft while a send created the same
 * revision's quote died on the unique `(enquiry, business, revision)` — whichever
 * committed second was a 500. And a save that had read the draft just before a
 * send promoted it then deleted and rewrote the lines of a quote the buyer
 * already held, because nothing on a goods quote refuses that.
 *
 * Under the lock a save and a send are serialised, and the save checks it is
 * still writing what it set out to:
 *
 *  - a draft is there at the revision it aimed at: update it;
 *  - no draft, it saw none, and the next revision is still the one it aimed at:
 *    create it;
 *  - anything else means a send took that revision meanwhile — or "Start again"
 *    cleared the draft — and the typing it carries belongs to a quote that is
 *    no longer a draft. Write nothing. A fresh draft at the revision after would
 *    be a copy of what was just sent, restored on the next visit as if it were
 *    working.
 */
export async function claimDraftSlot(
  tx: Prisma.TransactionClient,
  enquiryId: string,
  businessId: string,
  aim: DraftAim,
): Promise<DraftSlot> {
  const current = await draftIn(tx, enquiryId, businessId);
  if (current) {
    return current.revision === aim.revision ? { kind: "update", id: current.id } : { kind: "superseded" };
  }
  if (aim.draftId !== null) return { kind: "superseded" };
  const revision = await nextRevisionFor(enquiryId, businessId, tx);
  return revision === aim.revision ? { kind: "create", revision } : { kind: "superseded" };
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
      paymentTerms: true,
      delivery: true,
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

  /*
     §7: the composer is read-only on a marked outcome, a suspended listing or a
     closed enquiry — and, since board `7c`, on an accepted one. Autosave must
     not be the way around a rule the buttons enforce, so it asks the same fence
     a send does — here for the answer, and again under the lock below.
  */
  const fence = await readQuoteFence(prisma, input.enquiryId, businessId);
  if (!fence) return { ok: false, error: "not_your_enquiry" };
  const refusal = quoteFence(fence, new Date());
  if (refusal) return { ok: false, error: "fenced", reason: refusal, closesAt: fence.closesAt };
  if (await workEnquiryOf(prisma, input.enquiryId)) return { ok: false, error: "work_enquiry" };

  const validityDays = VALIDITY_CHOICES.includes(input.validityDays as (typeof VALIDITY_CHOICES)[number])
    ? input.validityDays
    : DEFAULT_VALIDITY_DAYS;
  const paymentTerms = parsePaymentTerms(input.paymentTerms);
  const delivery = parseDeliveryTerms(input.delivery);

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
      /*
         Null survives, and that is the change. It used to coerce anything that
         was not a positive integer to `1` — which was right while the column
         was NOT NULL and is now the bug it was covering for: a service line has
         no quantity, and writing one back would put `×1` on an audit.
      */
      qty: line.qty === null ? null : Number.isInteger(line.qty) && line.qty > 0 ? line.qty : 1,
      unitPrice: priceOf(line.unitPrice) as string,
      leadTimeDays: line.leadTimeDays,
      sortOrder: i,
      // Which enquiry line this was, so a reload puts it back on the right row.
      // Without it a draft with three of eight lines priced restores in order
      // rather than in place.
      enquiryLineId: line.enquiryLineId,
    }));

  const now = new Date();
  const aim = await aimDraft(input.enquiryId, businessId);
  const draft = {
    note: input.note || null,
    validityDays,
    paymentTerms,
    delivery,
    lines: { create: lines },
  };

  return prisma.$transaction(async (tx): Promise<SaveDraftResult> => {
    // The lock a send takes, so the two cannot interleave. `claimDraftSlot` says why.
    const locked = await lockQuoteFence(tx, input.enquiryId, businessId);
    if (!locked) return { ok: false, error: "not_your_enquiry" };
    const lockedRefusal = quoteFence(locked, now);
    if (lockedRefusal) return { ok: false, error: "fenced", reason: lockedRefusal, closesAt: locked.closesAt };

    const slot = await claimDraftSlot(tx, input.enquiryId, businessId, aim);
    if (slot.kind === "superseded") return { ok: false, error: "superseded" };

    if (slot.kind === "update") {
      await tx.quoteLine.deleteMany({ where: { quoteId: slot.id } });
      await tx.quote.update({ where: { id: slot.id }, data: { ...draft, updatedAt: now } });
    } else {
      await tx.quote.create({
        data: {
          // A draft has no reference yet. `ref` is unique and a buyer never sees
          // this row, so it carries a private placeholder that `sendQuoteForBusiness`
          // replaces with the real one at the moment it becomes a quote.
          ref: draftRef(input.enquiryId, businessId, slot.revision),
          enquiryId: input.enquiryId,
          businessId,
          revision: slot.revision,
          status: "draft",
          ...draft,
        },
      });
    }
    return { ok: true, savedAt: now, lines: lines.length };
  });
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

/** Exported for board `3j-s`, whose drafts are the same row with a proposal beside it. */
export function draftRef(enquiryId: string, businessId: string, revision: number): string {
  return `DRAFT-${enquiryId.slice(-8)}-${businessId.slice(-6)}-R${revision}`;
}
