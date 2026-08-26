import "server-only";
import { prisma } from "@/lib/db/client";
import { createProvisionalIdentity } from "@/lib/auth/flow";
import { normaliseIdentifier } from "@/lib/auth/identity";
import { onEnquiryDelivered, onQuoteAccepted } from "@/lib/notify/events";
import { quoteTotalAed } from "@/lib/quote/money";
import {
  MAX_RECIPIENTS,
  monthStart,
  selectRecipients,
  type FanoutCandidate,
  type FanoutRequest,
  type FanoutResult,
} from "./fanout";

/**
 * Creating an enquiry, and accepting a quote.
 *
 * The two ends of the engine. Everything in between — the seller's composer,
 * the thread — sits between these two writes.
 *
 * Both take a buyer id rather than reading a session, so both can be tested
 * against a real database without a request, and so the anonymous path and the
 * signed-in path go through exactly the same code.
 */

const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null } } as const;

/**
 * Who could answer this.
 *
 * Only claimed listings: an unclaimed one has nobody behind it, and delivering
 * an enquiry to an empty inbox is worse than delivering it to one fewer
 * supplier. Suspended and unpublished are excluded everywhere, as they are on
 * every public read.
 */
export async function findFanoutCandidates(
  request: FanoutRequest & { excludeBusinessIds?: readonly string[] },
  now: Date = new Date(),
): Promise<FanoutCandidate[]> {
  const since = monthStart(now);

  const businesses = await prisma.business.findMany({
    where: {
      ...PUBLIC_BUSINESS,
      claimStatus: "claimed",
      ...(request.excludeBusinessIds?.length
        ? { id: { notIn: [...request.excludeBusinessIds] } }
        : {}),
      OR: [
        { primaryCategoryId: request.categoryId },
        { categories: { some: { categoryId: request.categoryId } } },
      ],
    },
    select: {
      id: true,
      slug: true,
      displayName: true,
      primaryCategoryId: true,
      verificationTier: true,
      responseTimeMedianMs: true,
      categories: { select: { categoryId: true } },
      plan: { select: { enquiriesPerMonth: true, rankingMultiplier: true } },
      locations: { where: { published: true }, select: { emirate: true }, take: 1 },
      _count: {
        select: {
          // The month's load, which is what the cap counts.
          recipients: { where: { createdAt: { gte: since } } },
          products: { where: { status: "live" } },
        },
      },
    },
    // A bounded pool. Ranking eight out of a few hundred is the job; ranking
    // eight out of every business in the country is a different one.
    take: 60,
  });

  return businesses.map((business) => ({
    businessId: business.id,
    slug: business.slug,
    displayName: business.displayName,
    categoryIds: business.categories.map((c) => c.categoryId),
    primaryCategoryId: business.primaryCategoryId,
    emirate: business.locations[0]?.emirate ?? "",
    verificationTier: business.verificationTier,
    responseTimeMedianMs: business.responseTimeMedianMs,
    // Filled in by the caller when it has matched the lines. Without line
    // matching, coverage is "they list in this category and have a catalogue".
    matchedLineCount: business._count.products > 0 ? request.lineCount : 0,
    inStockLineCount: 0,
    enquiriesPerMonth: business.plan?.enquiriesPerMonth ?? null,
    enquiriesThisMonth: business._count.recipients,
    rankingMultiplier: business.plan?.rankingMultiplier ?? 1,
  }));
}

export interface EnquiryLineInput {
  description: string;
  qty: number;
  /** The product the buyer was looking at, where they were looking at one. */
  productId?: string | null;
  unit?: string | null;
  size?: string | null;
  /** The buyer's own budget per unit. Never a supplier price. */
  targetUnitPriceAed?: string | null;
}

export interface CreateEnquiryInput {
  /** Null for a buyer with no account. One is created for them. */
  buyerId: string | null;
  /** Required when there is no buyerId: the lightweight identity is built on it. */
  phone?: string | null;
  fullName?: string | null;
  buyerCompanyId?: string | null;

  requirement: string;
  lines: EnquiryLineInput[];
  categoryId: string;
  emirate?: string | null;
  deliverToArea?: string | null;
  neededBy?: Date | null;
  termsWanted?: string | null;
  /** How long sellers have. Board 1h's third step. */
  closesInDays?: number;

  /** The storefront the buyer came from. Always a recipient if it can answer. */
  pinnedBusinessIds?: readonly string[];
  /** 1..8. "also send to N similar suppliers". */
  fanoutTo: number;
}

export type CreateEnquiryResult =
  | {
      ok: true;
      enquiryId: string;
      ref: string;
      recipients: FanoutCandidate[];
      skipped: FanoutResult["skipped"];
      /**
       * Set only for a buyer with no account: the bearer token their tracking
       * link carries. Without it they send an enquiry and immediately cannot
       * see it, which is the whole promise of letting them send one.
       */
      claimToken: string | null;
    }
  | { ok: false; error: "no_buyer" | "no_lines" | "no_recipients" };

/** Board 1h's picker. Anything else is coerced rather than trusted. */
const CLOSES_IN_DAYS_CHOICES = [3, 5, 7, 14, 21] as const;
const DEFAULT_CLOSES_IN_DAYS = 7;

function closesInDays(asked: number | undefined): number {
  return CLOSES_IN_DAYS_CHOICES.includes(asked as (typeof CLOSES_IN_DAYS_CHOICES)[number])
    ? asked!
    : DEFAULT_CLOSES_IN_DAYS;
}

export async function createEnquiry(
  input: CreateEnquiryInput,
  now: Date = new Date(),
): Promise<CreateEnquiryResult> {
  if (input.lines.length === 0) return { ok: false, error: "no_lines" };

  /*
   * A buyer with no account gets one that does nothing but own this enquiry.
   * The README is explicit that requiring signup before the first enquiry is
   * the fastest way to kill the funnel, so the identity is created here and
   * claimed later — see createProvisionalIdentity.
   */
  let buyerId = input.buyerId;
  let claimToken: string | null = null;
  if (!buyerId) {
    if (!input.phone || !normaliseIdentifier(input.phone)) return { ok: false, error: "no_buyer" };
    const identity = await createProvisionalIdentity({
      phone: input.phone,
      fullName: input.fullName ?? null,
    });
    if (!identity) return { ok: false, error: "no_buyer" };
    buyerId = identity.userId;

    const provisional = await prisma.user.findUnique({
      where: { id: buyerId },
      select: { claimToken: true, isProvisional: true },
    });
    claimToken = provisional?.isProvisional ? provisional.claimToken : null;
  }

  const request: FanoutRequest = {
    categoryId: input.categoryId,
    emirate: input.emirate ?? null,
    lineCount: input.lines.length,
    want: input.fanoutTo,
    ...(input.pinnedBusinessIds ? { pinned: input.pinnedBusinessIds } : {}),
  };

  const candidates = await findFanoutCandidates(request, now);
  const { recipients, skipped } = selectRecipients(candidates, request);
  if (recipients.length === 0) return { ok: false, error: "no_recipients" };

  const ref = await nextEnquiryRef();
  // Never zero. An enquiry that closes the instant it is sent is one nobody
  // can answer, and a form can post anything.
  const closesAt = new Date(now.getTime() + closesInDays(input.closesInDays) * 86_400_000);

  const enquiry = await prisma.$transaction(async (tx) => {
    const created = await tx.enquiry.create({
      data: {
        ref,
        buyerId,
        buyerCompanyId: input.buyerCompanyId ?? null,
        requirement: input.requirement.trim(),
        deliverToArea: input.deliverToArea ?? null,
        neededBy: input.neededBy ?? null,
        termsWanted: (input.termsWanted as never) ?? null,
        closesAt,
        lines: {
          create: input.lines.map((line, i) => ({
            description: line.description.trim(),
            qty: line.qty,
            productId: line.productId ?? null,
            unit: line.unit ?? null,
            size: line.size ?? null,
            targetUnitPriceAed: line.targetUnitPriceAed ?? null,
            sortOrder: i,
          })),
        },
      },
      select: { id: true, ref: true },
    });

    await tx.enquiryRecipient.createMany({
      data: recipients.map((r) => ({ enquiryId: created.id, businessId: r.businessId })),
    });

    // In the same transaction as the recipients. A seller who was left out was
    // left out of *this* enquiry, and recording it separately afterwards means
    // a crash in between produces an enquiry nobody was told they missed.
    if (skipped.length > 0) {
      await tx.missedEnquiry.createMany({
        data: skipped.map((s) => ({
          enquiryId: created.id,
          businessId: s.businessId,
          reason: s.reason,
        })),
      });
    }

    return created;
  });

  /*
   * After the transaction, never inside it. A carrier being slow must not hold
   * a database transaction open, and a carrier being down must not roll back
   * an enquiry that was successfully delivered to eight inboxes.
   */
  await onEnquiryDelivered({
    enquiryId: enquiry.id,
    businessIds: recipients.map((r) => r.businessId),
    valueAed: estimatedValueAed(input.lines),
  });

  return { ok: true, enquiryId: enquiry.id, ref: enquiry.ref, recipients, skipped, claimToken };
}

/**
 * What the enquiry is roughly worth, for the quiet-hours override.
 *
 * From the buyer's own target prices, which are the only numbers an enquiry
 * carries — there are no supplier prices yet, by definition. A line with no
 * target contributes nothing, so this reads low rather than high, and a seller
 * woken at midnight was woken for an enquiry that really is large.
 */
function estimatedValueAed(lines: readonly EnquiryLineInput[]): number | null {
  let total = 0;
  let known = false;
  for (const line of lines) {
    const target = Number(line.targetUnitPriceAed);
    if (Number.isFinite(target) && target > 0) {
      total += target * line.qty;
      known = true;
    }
  }
  return known ? Math.round(total) : null;
}

/**
 * `ENQ-8901`. Allocated by Postgres, so two enquiries sent in the same second
 * cannot collide and there is no retry loop pretending to be a sequence.
 */
async function nextEnquiryRef(): Promise<string> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('enquiry_ref_seq') AS n`;
  return `ENQ-${row!.n}`;
}

export type AcceptQuoteResult =
  | { ok: true; enquiryId: string; businessId: string; declined: number }
  | { ok: false; error: "not_found" | "not_yours" | "already_accepted" | "quote_expired" };

/**
 * Accepting a quote. The terminal state of the whole product.
 *
 * Acceptance criterion 3: it sets `contactReleasedToBusinessId`, marks the
 * other recipients declined, and **creates no other row**. No order, no
 * fulfilment record, no payment, no invoice to the buyer. The platform never
 * becomes party to the transaction; the two of them settle it directly on terms
 * they agreed. If a future task here seems to need another table, the task is
 * wrong — stop and ask.
 *
 * Everything runs in one transaction. A release without the declines would
 * leave four sellers holding a live enquiry that is already lost, and a decline
 * without the release would lose the buyer the number they just earned.
 */
export async function acceptQuote(
  buyerId: string,
  quoteId: string,
  now: Date = new Date(),
): Promise<AcceptQuoteResult> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      businessId: true,
      ref: true,
      status: true,
      expiresAt: true,
      enquiry: { select: { id: true, buyerId: true, contactReleasedToBusinessId: true } },
    },
  });
  if (!quote) return { ok: false, error: "not_found" };
  // Somebody else's enquiry and a missing one are the same answer.
  if (quote.enquiry.buyerId !== buyerId) return { ok: false, error: "not_found" };
  if (quote.enquiry.contactReleasedToBusinessId) return { ok: false, error: "already_accepted" };
  if (quote.expiresAt && quote.expiresAt.getTime() < now.getTime()) {
    return { ok: false, error: "quote_expired" };
  }

  const accepted = await prisma.$transaction(async (tx) => {
    await tx.enquiry.update({
      where: { id: quote.enquiry.id },
      data: {
        contactReleasedToBusinessId: quote.businessId,
        contactReleasedAt: now,
      },
    });

    await tx.quote.update({
      where: { id: quote.id },
      data: { status: "accepted", acceptedAt: now },
    });

    // Every other recipient is out. Told plainly, and told now rather than
    // left to wonder — the enquiry is closed to them either way.
    const declined = await tx.enquiryRecipient.updateMany({
      where: { enquiryId: quote.enquiry.id, businessId: { not: quote.businessId } },
      data: { state: "declined" },
    });

    await tx.enquiryRecipient.updateMany({
      where: { enquiryId: quote.enquiry.id, businessId: quote.businessId },
      data: { state: "quoted" },
    });

    /*
     * Every other supplier's quote is lost, with the reason on the row.
     *
     * Not the accepted supplier's own earlier revisions: those were superseded
     * by their own r2, which the revision number already says, and calling
     * them lost would tell that seller they lost an enquiry they won.
     *
     * `lostReason` holds a stable code rather than a sentence. It is rendered
     * through t() like everything else — English in a database column is a
     * translation that can never happen.
     */
    await tx.quote.updateMany({
      where: {
        enquiryId: quote.enquiry.id,
        businessId: { not: quote.businessId },
        status: { in: ["sent", "read"] },
      },
      data: { status: "lost", lostReason: "buyer_accepted_another" },
    });

    return {
      ok: true as const,
      enquiryId: quote.enquiry.id,
      businessId: quote.businessId,
      declined: declined.count,
    };
  });

  if (accepted.ok) {
    const total = await prisma.quoteLine.findMany({
      where: { quoteId: quote.id },
      select: { qty: true, unitPrice: true },
    });
    await onQuoteAccepted({
      enquiryId: accepted.enquiryId,
      businessId: accepted.businessId,
      quoteRef: quote.ref,
      totalAed: quoteTotalAed(total.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() }))),
    });
  }

  return accepted;
}

export { CLOSES_IN_DAYS_CHOICES, MAX_RECIPIENTS };
