import "server-only";
import { prisma } from "@/lib/db/client";
import { actorFor } from "@/lib/auth/actor";
import { assertCanAcceptQuote } from "@/lib/auth/guards";
import { gateCompanyAcceptance, GateRefused, readReference, type GateRefusal } from "@/lib/buyer-company/gate";
import type { AskPart, StoredPart } from "@/lib/buyer-company/split-request";
import { getQuoteComparison } from "@/lib/db/queries/quote-comparison";
import { formatList } from "@/lib/format";
import { onQuoteAccepted, onQuotePartlyAccepted, onQuotesDeclined } from "@/lib/notify/events";
import { buildComparison } from "@/lib/quote/comparison";
import { filsToAed, lineTotalFils, quoteTotalAed } from "@/lib/quote/money";
import { picksFromParts, planSplit, type SplitPick, type SplitPlan, type SplitRefusal } from "@/lib/quote/split";
import { recordEvent } from "@/lib/telemetry/record";

/**
 * Accepting — the terminal state of the whole product — for one quote or, since
 * board `1o`, for lines from several in one decision.
 *
 * `acceptQuote` and `acceptSplit` both commit through `commitAcceptance`, so the
 * claim, the re-read under the lock, the company's rule, the releases and the
 * declines are one code path whatever the buyer pressed. **It creates no other
 * row** (acceptance criterion 3, `lib/enquiry/service.ts`): a split marks the
 * quotes accepted, the lines each covers, and each supplier the buyer's contact
 * went to — columns on rows that already exist. No order, no fulfilment record,
 * no payment. The platform is never party to the transaction.
 */

/**
 * Board `7b`. What a company acceptance carries, and — from the approval
 * queue — which request it is the approval of.
 */
export interface AcceptOptions {
  /** Written to `Enquiry.buyerReference` and the quote's own `buyerReference`. */
  poNumber?: string | null;
  /** Board `1o` D5: a split's PO numbers, by quote — a PO is issued to one supplier. */
  poNumbers?: Readonly<Record<string, string | null>>;
  costCode?: string | null;
  approval?: { id: string; approverId: string } | null;
  /**
   * Which screen the acceptance was pressed on, for the `quote_accepted` event
   * only — board `1n`'s telemetry asks whether buyers decide on the comparison
   * or in a thread. It changes nothing about what accepting does (`10h` B6).
   */
  source?: "compare" | "thread" | "company" | "approval";
}

/** One supplier's share of an acceptance. */
export interface CommitPart {
  quoteId: string;
  quoteRef: string;
  businessId: string;
  revision: number;
  /** The buyer's lines taken (D2). Null: the whole quote. */
  enquiryLineIds: string[] | null;
}

export type CommitRefusal =
  | "already_accepted"
  | "not_open"
  | "revised"
  | "enquiry_closed"
  | "quote_expired"
  | "supplier_closed"
  | GateRefusal;

export type CommitResult =
  | { ok: true; enquiryId: string; declined: number; parts: CommitPart[] }
  | { ok: false; error: CommitRefusal; quoteId?: string };

/** A refusal found under the lock, thrown so the claim rolls back with it. */
class CommitRefused extends Error {
  constructor(
    readonly code: CommitRefusal,
    readonly quoteId?: string,
  ) {
    super(code);
  }
}

/**
 * The transaction every acceptance commits through.
 *
 * The claim is the lock: a conditional update with the null in its `where`, so
 * a second acceptance a second later waits for the first and then matches
 * nothing — and `lockQuoteFence` waits on the same row, so no supplier's send
 * lands between. Everything that can change under the buyer is read again
 * behind it; a refusal throws, and the claim rolls back with it.
 *
 * `primaryBusinessId` goes on `Enquiry.contactReleasedToBusinessId`, which every
 * "is this enquiry decided" check and two triggers read. Who the buyer's
 * contact went to is written on each supplier's recipient row — one for an
 * ordinary accept, one per supplier for a split.
 */
export async function commitAcceptance(input: {
  /** In whose name the acceptance goes out: the buyer, or the colleague who raised the request. */
  buyerId: string;
  enquiry: { id: string; buyerCompanyId: string | null };
  parts: CommitPart[];
  primaryBusinessId: string;
  now: Date;
  options: AcceptOptions;
}): Promise<CommitResult> {
  const { enquiry, parts, now, options } = input;
  const accepted = [...new Set(parts.map((part) => part.businessId))];
  const split = parts.length > 1 || parts.some((part) => part.enquiryLineIds !== null);

  return prisma
    .$transaction(async (tx) => {
      const claimed = await tx.enquiry.updateMany({
        where: { id: enquiry.id, contactReleasedToBusinessId: null },
        data: { contactReleasedToBusinessId: input.primaryBusinessId, contactReleasedAt: now },
      });
      if (claimed.count === 0) return { ok: false as const, error: "already_accepted" as const };

      // A revision of the requirement can move the close; read it where the claim holds.
      const locked = await tx.enquiry.findUniqueOrThrow({ where: { id: enquiry.id }, select: { closesAt: true } });
      if (locked.closesAt.getTime() <= now.getTime()) throw new CommitRefused("enquiry_closed");

      /*
         Each quote again, under the lock. A sweep can expire one, a supplier can
         send a revision or close their account, between the page the buyer
         pressed on and this instant. Accepting revision 2 once revision 3 exists
         would fix as the record a price the supplier has already replaced.
      */
      for (const part of parts) {
        const current = await tx.quote.findUniqueOrThrow({
          where: { id: part.quoteId },
          select: { status: true, expiresAt: true, business: { select: { closureRequestedAt: true } } },
        });
        if (current.status !== "sent" && current.status !== "read") throw new CommitRefused("not_open", part.quoteId);
        if (current.expiresAt && current.expiresAt.getTime() < now.getTime()) {
          throw new CommitRefused("quote_expired", part.quoteId);
        }
        if (current.business.closureRequestedAt) throw new CommitRefused("supplier_closed", part.quoteId);
        const later = await tx.quote.count({
          where: {
            enquiryId: enquiry.id,
            businessId: part.businessId,
            revision: { gt: part.revision },
            status: { not: "draft" },
          },
        });
        if (later > 0) throw new CommitRefused("revised", part.quoteId);
      }

      /*
         Board `7b`: an enquiry raised for a buying company passes its rule here,
         under the claim — and for a split (`1o` D5) once, on the parts together.
         The company is the enquiry's, not the buyer's today.
      */
      let poNumbers = new Map<string, string | null>();
      if (enquiry.buyerCompanyId) {
        const po = readReference(options.poNumber);
        const cost = readReference(options.costCode);
        if (po === "too_long" || po === "invalid" || cost === "too_long" || cost === "invalid") {
          throw new CommitRefused("reference_invalid");
        }
        let askParts: AskPart[] | undefined;
        if (split) {
          askParts = [];
          for (const part of parts) {
            const ref = readReference(options.poNumbers?.[part.quoteId]);
            if (ref === "too_long" || ref === "invalid") throw new CommitRefused("reference_invalid", part.quoteId);
            askParts.push({ quoteId: part.quoteId, enquiryLineIds: part.enquiryLineIds, poNumber: ref });
          }
        }
        const primary = parts.find((part) => part.businessId === input.primaryBusinessId) ?? parts[0]!;
        const gated = await gateCompanyAcceptance(tx, {
          companyId: enquiry.buyerCompanyId,
          enquiryId: enquiry.id,
          quoteId: primary.quoteId,
          quoteRef: formatList(parts.map((part) => part.quoteRef)),
          raiserId: input.buyerId,
          now,
          poNumber: split ? null : po,
          costCode: cost,
          approval: options.approval ?? null,
          ...(askParts ? { parts: askParts } : {}),
        }).catch((error: unknown) => {
          if (error instanceof GateRefused) throw new CommitRefused(error.code);
          throw error;
        });
        await tx.enquiry.update({
          where: { id: enquiry.id },
          data: {
            ...(gated.poNumber ? { buyerReference: gated.poNumber } : {}),
            ...(gated.costCode ? { costCode: gated.costCode } : {}),
          },
        });
        poNumbers = split ? new Map(gated.poNumbers) : new Map([[primary.quoteId, gated.poNumber]]);
      }

      for (const part of parts) {
        await tx.quote.update({
          where: { id: part.quoteId },
          data: { status: "accepted", acceptedAt: now, buyerReference: poNumbers.get(part.quoteId) ?? null },
        });
        /*
           The lines this acceptance covers. A whole quote: all of them. A part:
           the buyer's chosen lines, and the lines the supplier added of their
           own — a delivery charge answers none of the buyer's lines and goes
           with any part (D7).
        */
        await tx.quoteLine.updateMany({
          where: {
            quoteId: part.quoteId,
            ...(part.enquiryLineIds
              ? { OR: [{ enquiryLineId: { in: part.enquiryLineIds } }, { enquiryLineId: null }] }
              : {}),
          },
          data: { acceptedAt: now },
        });
      }

      // Every other recipient is out. Told plainly, and told now rather than
      // left to wonder — the enquiry is closed to them either way.
      const declined = await tx.enquiryRecipient.updateMany({
        where: { enquiryId: enquiry.id, businessId: { notIn: accepted } },
        data: { state: "declined" },
      });
      // And the buyer's contact goes to each supplier accepted from (D4).
      await tx.enquiryRecipient.updateMany({
        where: { enquiryId: enquiry.id, businessId: { in: accepted } },
        data: { state: "quoted", contactReleasedAt: now },
      });

      /*
       * Every other supplier's quote is lost, with the reason on the row.
       *
       * Not an accepted supplier's own earlier revisions: those were superseded
       * by their own later one, which the revision number already says, and
       * calling them lost would tell that seller they lost an enquiry they won.
       */
      await tx.quote.updateMany({
        where: { enquiryId: enquiry.id, businessId: { notIn: accepted }, status: { in: ["sent", "read"] } },
        data: { status: "lost", lostReason: "buyer_accepted_another" },
      });

      return { ok: true as const, enquiryId: enquiry.id, declined: declined.count, parts };
    })
    .catch((error: unknown) => {
      if (error instanceof CommitRefused) {
        return { ok: false as const, error: error.code, ...(error.quoteId ? { quoteId: error.quoteId } : {}) };
      }
      throw error;
    });
}

/**
 * After the commit: each supplier told what was accepted from them, every other
 * supplier told their quote was not, and the event recorded per supplier — the
 * acceptance is each winner's fact too.
 */
export async function announceAcceptance(input: {
  enquiryId: string;
  parts: CommitPart[];
  actorId: string;
  source: NonNullable<AcceptOptions["source"]>;
}): Promise<void> {
  const split = input.parts.length > 1 || input.parts.some((part) => part.enquiryLineIds !== null);
  for (const part of input.parts) {
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: part.quoteId },
      select: {
        lines: {
          select: {
            enquiryLineId: true,
            qty: true,
            unitPrice: true,
            acceptedAt: true,
            enquiryLine: { select: { description: true, qty: true, sortOrder: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
        proposal: { select: { feeAed: true, feeBasisLabel: true } },
      },
    });
    const covered = quote.lines.filter((line) => line.acceptedAt !== null);
    const totalAed = quoteTotalAed(covered.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() })));

    if (part.enquiryLineIds === null) {
      await onQuoteAccepted({
        enquiryId: input.enquiryId,
        businessId: part.businessId,
        quoteRef: part.quoteRef,
        totalAed,
        /*
           Board `3j-s`: an accepted proposal's figure is its fee on its basis.
           The line sum is `0.00` and would tell the supplier they won nothing.
        */
        ...(quote.proposal?.feeAed && quote.proposal.feeBasisLabel
          ? { proposal: { feeAed: quote.proposal.feeAed.toString(), feeBasisLabel: quote.proposal.feeBasisLabel } }
          : {}),
      });
    } else {
      const taken = new Set(part.enquiryLineIds);
      const asked = new Map<string, { description: string; qty: number | null; sortOrder: number }>();
      for (const line of quote.lines) {
        if (line.enquiryLineId && line.enquiryLine && !asked.has(line.enquiryLineId)) asked.set(line.enquiryLineId, line.enquiryLine);
      }
      await onQuotePartlyAccepted({
        enquiryId: input.enquiryId,
        businessId: part.businessId,
        quoteRef: part.quoteRef,
        lines: [...asked.entries()]
          .filter(([id]) => taken.has(id))
          .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
          .map(([, line]) => ({ description: line.description, qty: line.qty })),
        pricedLines: asked.size,
        totalAed: filsToAed(covered.reduce((sum, line) => sum + lineTotalFils({ qty: line.qty, unitPrice: line.unitPrice.toString() }), 0n)),
      });
    }

    await recordEvent({
      name: "quote_accepted",
      businessId: part.businessId,
      actorId: input.actorId,
      props: {
        source: input.source,
        lines: covered.length,
        proposal: quote.proposal !== null,
        split,
      },
    });
  }

  /*
     Board `1n` `B8`: the quotes that lost are declined out loud, not by a status
     change nobody reads — to every supplier nothing was accepted from.
  */
  await onQuotesDeclined({
    enquiryId: input.enquiryId,
    acceptedBusinessIds: input.parts.map((part) => part.businessId),
  });
}

/** Why a split was refused: the selection itself, or what the commit found under the lock. */
export type AcceptSplitError = CommitRefusal | SplitRefusal | "not_found";

export type AcceptSplitResult =
  | { ok: true; enquiryId: string; parts: { quoteId: string; businessId: string; whole: boolean }[] }
  | { ok: false; error: AcceptSplitError; lineId?: string; quoteId?: string };

/** A split checked against the comparison as it stands, ready to commit. */
export type PreparedSplit =
  | {
      ok: true;
      enquiry: { id: string; ref: string; buyerCompanyId: string | null };
      plan: SplitPlan;
      parts: CommitPart[];
    }
  | { ok: false; error: AcceptSplitError; lineId?: string; quoteId?: string };

/**
 * The buyer's selection, planned against the comparison built again from the
 * database (`planSplit`: D1, D2, D7) — so what is committed, or put to an
 * approver, is what the buyer's figures were computed from.
 *
 * The selection is the buyer's picks, or a request's parts as they were asked
 * (D5), which must still be the quotes current then: a supplier's later
 * revision is a price nobody approved.
 */
export async function prepareSplit(
  buyerId: string,
  enquiryRefOrId: string,
  selection: readonly SplitPick[] | { parts: readonly StoredPart[] },
  now: Date,
): Promise<PreparedSplit> {
  const data = await getQuoteComparison(buyerId, enquiryRefOrId);
  if (!data) return { ok: false, error: "not_found" };
  if (data.enquiry.acceptedBusinessId) return { ok: false, error: "already_accepted" };
  if (data.enquiry.closesAt.getTime() <= now.getTime()) return { ok: false, error: "enquiry_closed" };

  const revisionOf = new Map(
    data.input.recipients.flatMap((recipient) => (recipient.quote ? [[recipient.quote.id, recipient.quote.revision] as const] : [])),
  );
  const model = buildComparison(data.input, now);

  let picks: readonly SplitPick[];
  if ("parts" in selection) {
    const moved = selection.parts.find((part) => revisionOf.get(part.quoteId) !== part.quoteRevision);
    if (moved) return { ok: false, error: "revised", quoteId: moved.quoteId };
    const asked = picksFromParts(model, selection.parts);
    if (!asked) return { ok: false, error: "revised" };
    picks = asked;
  } else {
    // A quote the buyer chose that has since been revised is the supplier's old price: say so.
    const stale = selection.find((pick) => !revisionOf.has(pick.quoteId));
    if (stale) {
      const known = await prisma.quote.count({ where: { id: stale.quoteId, enquiryId: data.enquiry.id } });
      if (known > 0) return { ok: false, error: "revised", quoteId: stale.quoteId, lineId: stale.lineId };
    }
    picks = selection;
  }

  const planned = planSplit(model, picks);
  if (!planned.ok) return { ok: false, error: planned.error, ...(planned.lineId ? { lineId: planned.lineId } : {}) };
  const { plan } = planned;

  return {
    ok: true,
    enquiry: { id: data.enquiry.id, ref: data.enquiry.ref, buyerCompanyId: data.enquiry.buyerCompanyId },
    plan,
    parts: plan.parts.map((part) => ({
      quoteId: part.quoteId,
      quoteRef: part.quoteRef,
      businessId: part.supplier.businessId,
      revision: revisionOf.get(part.quoteId)!,
      enquiryLineIds: part.whole ? null : part.lineIds,
    })),
  };
}

/**
 * Board `1o` — accept the chosen lines, each from the supplier chosen for it,
 * in one decision (D3).
 *
 * Every line from one supplier, all of what they priced, is the ordinary accept
 * (AC7): one whole part, through the same commit as `acceptQuote`.
 */
export async function acceptSplit(
  buyerId: string,
  enquiryRefOrId: string,
  picks: readonly SplitPick[],
  now: Date = new Date(),
  options: AcceptOptions = {},
): Promise<AcceptSplitResult> {
  // Build plan 9.4: `quote.accept`, before anything is read. Throws `PermissionError`.
  assertCanAcceptQuote(await actorFor(buyerId));
  return commitPrepared(buyerId, await prepareSplit(buyerId, enquiryRefOrId, picks, now), now, options);
}

/**
 * Board `1o` D5 — a split approved from the queue: the parts as the raiser
 * asked them, accepted in the raiser's name on the approver's authority. The
 * request fixed the parts (`quote_approval_is_the_request`), and the gate
 * refuses a commit whose parts or value differ from it.
 */
export async function acceptRequestedSplit(
  raiserId: string,
  enquiryId: string,
  parts: readonly StoredPart[],
  now: Date,
  options: AcceptOptions,
): Promise<AcceptSplitResult> {
  // Build plan 9.4: the acceptance goes out in the raiser's name, so theirs is asked, as `acceptQuote` asks it.
  assertCanAcceptQuote(await actorFor(raiserId));
  const poNumbers = Object.fromEntries(parts.map((part) => [part.quoteId, part.poNumber]));
  return commitPrepared(raiserId, await prepareSplit(raiserId, enquiryId, { parts }, now), now, { ...options, poNumbers });
}

async function commitPrepared(
  buyerId: string,
  prepared: PreparedSplit,
  now: Date,
  options: AcceptOptions,
): Promise<AcceptSplitResult> {
  if (!prepared.ok) return prepared;
  const { enquiry, plan, parts } = prepared;

  // One supplier's whole quote takes its PO number the ordinary way.
  const single = plan.single ? parts[0]! : null;
  const committed = await commitAcceptance({
    buyerId,
    enquiry: { id: enquiry.id, buyerCompanyId: enquiry.buyerCompanyId },
    parts,
    primaryBusinessId: plan.primaryBusinessId,
    now,
    options:
      single && options.poNumber === undefined && options.poNumbers
        ? { ...options, poNumber: options.poNumbers[single.quoteId] ?? null }
        : options,
  });
  if (!committed.ok) return committed;

  await announceAcceptance({
    enquiryId: committed.enquiryId,
    parts: committed.parts,
    actorId: options.approval?.approverId ?? buyerId,
    source: options.source ?? "compare",
  });
  return {
    ok: true,
    enquiryId: committed.enquiryId,
    parts: plan.parts.map((part) => ({ quoteId: part.quoteId, businessId: part.supplier.businessId, whole: part.whole })),
  };
}
