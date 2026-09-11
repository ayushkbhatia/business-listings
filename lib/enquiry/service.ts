import "server-only";
import type { Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { tradeKindFor } from "@/lib/taxonomy/service";
import { createProvisionalIdentity } from "@/lib/auth/flow";
import { normaliseIdentifier } from "@/lib/auth/identity";
import { routeLead } from "@/lib/leads/router";
import { sendAutoReplies } from "@/lib/messaging/auto-reply";
import { onEnquiryDelivered, onQuoteAccepted } from "@/lib/notify/events";
import { quoteTotalAed } from "@/lib/quote/money";
import type { Attribution } from "@/lib/campaign/attribution";
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
/**
 * A category and everything filed under it.
 *
 * The same rule `categoryIdsFor` applies on the search side, done here as a
 * query because the RFQ composer hands over an id and not a loaded row. Two
 * levels is what the taxonomy uses, so one hop is the whole tree.
 */
export async function descendantsOf(categoryId: string): Promise<string[]> {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  return [categoryId, ...children.map((child) => child.id)];
}

/**
 * What ranking needs off a candidate. Shared by the category pool and the
 * by-id top-up below, which have to return the same shape.
 */
const FANOUT_SELECT = (since: Date) =>
  ({
    id: true,
    slug: true,
    displayName: true,
    primaryCategoryId: true,
    verificationTier: true,
    responseTimeMedianMs: true,
    categories: { select: { categoryId: true } },
    plan: { select: { enquiriesPerMonth: true, rankingMultiplier: true } },
    /*
       Every published branch, not the first row Postgres returns.

       This was `take: 1` with no `orderBy`, so a supplier with a Dubai
       showroom and a Sharjah warehouse had one of them chosen at random and
       the other ignored — and the choice could differ between two runs of the
       same enquiry. The same shape of defect the seeds hit in board 3f.

       Branch count is capped by the plan, so there is no window to size here.
    */
    locations: { where: { published: true }, select: { emirate: true } },
    _count: {
      select: {
        // The month's load, which is what the cap counts.
        recipients: { where: { createdAt: { gte: since } } },
        products: { where: { status: "live" } },
      },
    },
  }) as const;

export async function findFanoutCandidates(
  request: FanoutRequest & { excludeBusinessIds?: readonly string[] },
  now: Date = new Date(),
): Promise<FanoutCandidate[]> {
  const since = monthStart(now);

  const pinned = [...(request.pinned ?? [])];

  const businesses = await prisma.business.findMany({
    where: {
      ...PUBLIC_BUSINESS,
      claimStatus: "claimed",
      ...(request.excludeBusinessIds?.length
        ? { id: { notIn: [...request.excludeBusinessIds] } }
        : {}),
      OR: [
        { primaryCategoryId: { in: [...request.categoryIds] } },
        /*
           An extra category only counts while its activity flag is clear.

           Board 2c, criterion 8. A seller may add any category up to their
           plan's cap and the chip is accepted — refusing inline on a text match
           against registry prose would tell a legitimate seller their own
           licence is wrong. What the flag buys is this line: until a reviewer
           clears it, the listing is out of the fan-out *for that category* and
           in every other one it holds. A paint trader does not receive
           electrical RFQs, and nobody had to guess at the form.

           The primary category is deliberately not filtered: it came from the
           licence import, and changing it goes through `ListingChangeRequest`,
           so a person has already looked at it.
        */
        {
          categories: {
            some: {
              categoryId: { in: [...request.categoryIds] },
              unverifiedActivityAt: null,
            },
          },
        },
        /*
           A supplier the buyer named is a candidate whatever they sell.

           `selectRecipients` only *sorts* by pinned, so before this arm a
           pinned supplier outside the requested category was never in the pool
           to be sorted — a buyer pressing "Request a quote" on a storefront got
           an enquiry that supplier was not on, silently and with no skip row to
           find afterwards. Every `?to=` link in the app omits `?category=`, so
           this was the normal path rather than an edge of it.

           It belongs here rather than in `request.categoryIds`, because
           `scoreCandidate` reads that set for its category term — widening it
           would make an off-category supplier score as though they were in it.
           This way they are present and still ranked honestly.
        */
        ...(pinned.length ? [{ id: { in: pinned } }] : []),
      ],
    },
    select: FANOUT_SELECT(since),
    /*
       A bounded pool. Ranking eight out of a few hundred is the job; ranking
       eight out of every business in the country is a different one.

       Ordered, unlike before, and by something stable. Without an `orderBy` the
       sixty rows are whatever Postgres hands back, so an in-category supplier
       could fall outside the window on one request and inside it on the next
       with nothing changed — including a pinned one, which made the arm above
       only probably work. Tier then id: the best-evidenced listings are the
       ones worth ranking, and the id breaks ties the same way twice.

       `pinned.length` is added to the window so naming eight suppliers cannot
       push eight ordinary candidates out of a pool sized for the ranking.
    */
    orderBy: [{ verificationTier: "desc" }, { id: "asc" }],
    take: 60 + pinned.length,
  });

  /*
     Anyone named but still missing — ranked below the window on tier, or
     excluded by `claimStatus` — is fetched by id so the pool is complete
     before ranking. Capped at eight by the page, so this is one small query.
  */
  const found = new Set(businesses.map((business) => business.id));
  const missing = pinned.filter((id) => !found.has(id));
  if (missing.length) {
    businesses.push(
      ...(await prisma.business.findMany({
        where: { ...PUBLIC_BUSINESS, claimStatus: "claimed", id: { in: missing } },
        select: FANOUT_SELECT(since),
      })),
    );
  }

  /*
     Where each candidate has said it works.

     A second query rather than a nested select, because coverage is one row
     per area and a supplier who serves forty Dubai areas would otherwise drag
     forty rows into a pool of sixty candidates to answer a question with seven
     possible values. `groupBy` asks the database for the distinct answer.

     `BusinessCoverage`'s own doc comment says it is "what `1h` routes on
     today". Until this, nothing in the fan-out read it at all — one writer,
     two dashboard readers, and the consumer named in the schema was not one of
     them.
  */
  const coverage = await prisma.businessCoverage.groupBy({
    by: ["businessId", "emirate"],
    where: { businessId: { in: businesses.map((business) => business.id) } },
  });
  const coveredBy = new Map<string, string[]>();
  for (const row of coverage) {
    const held = coveredBy.get(row.businessId);
    if (held) held.push(row.emirate);
    else coveredBy.set(row.businessId, [row.emirate]);
  }

  /*
     Whether this enquiry is about a thing or about a job.

     Resolved from the enquiry's own category, once, rather than per candidate.
     The question `matchedLineCount` answers is "how many of these lines does
     this seller have something for", and on a service enquiry there is no line
     that a product could answer — so the product proxy is meaningless for
     everyone on it, not only for the suppliers who happen to stock nothing.
  */
  const kind = await tradeKindFor(request.categoryId);

  return businesses.map((business) => ({
    businessId: business.id,
    slug: business.slug,
    displayName: business.displayName,
    categoryIds: business.categories.map((c) => c.categoryId),
    primaryCategoryId: business.primaryCategoryId,
    // Branches and coverage together, deduped. Empty stays empty: a listing
    // with neither is unmeasured, and `scoreCandidate` scores it as such.
    emirates: [
      ...new Set([
        ...business.locations.map((location) => location.emirate as string),
        ...(coveredBy.get(business.id) ?? []),
      ]),
    ],
    verificationTier: business.verificationTier,
    responseTimeMedianMs: business.responseTimeMedianMs,
    /*
       Still a proxy on a goods enquiry, and still the coarsest one: all of the
       lines or none of them, on whether any product is live. A supplier with
       one irrelevant listing scores the same as one with five hundred relevant
       ones, which is a separate defect and needs real line matching to fix.

       Null on a service enquiry, because there the proxy is not coarse but
       wrong. `coverage` is 0.34 — the largest term in the vector — and a
       freight forwarder, an auditor and a facilities contractor have no
       products by the nature of what they sell, so every one of them scored a
       hard zero on it for as long as the fan-out has existed. That is not a
       measurement of whether they can do the job; it is a measurement of a
       noun that does not apply. `scoreCandidate` scores null at the midpoint.
    */
    matchedLineCount: kind === "services" ? null : business._count.products > 0 ? request.lineCount : 0,
    /*
       Null, because nobody has ever counted it.

       It was `0` — a claim that every supplier in the country has nothing on
       the shelf, multiplied by 0.2 of the score on every enquiry ever sent.
       The field's own doc has always said a caller fills it in and no caller
       ever has, so the honest value is "not measured".
    */
    inStockLineCount: null,
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
  /**
   * Exactly who to send to, when the buyer has said.
   *
   * Board 1h's picker is a list of checkboxes, not a count — a buyer who
   * unticks two sellers has made a decision about those two. Routing that
   * through `pinnedBusinessIds` and `fanoutTo` came close but was not the same
   * thing: pinning only *sorts* a candidate to the front, so a seller who
   * became ineligible between the preview and the send would have been quietly
   * replaced by whoever ranked next — an enquiry delivered to somebody the
   * buyer had not chosen, and possibly to one they had deliberately removed.
   *
   * When this is set the matcher still runs, and still refuses anyone it would
   * not have offered — a seller at their monthly cap stays out even if the id
   * is in this list. What it may no longer do is substitute.
   */
  chosenBusinessIds?: readonly string[];
  /** 1..8. "also send to N similar suppliers". */
  fanoutTo: number;
  /**
   * Where the buyer came from, if anywhere. Criterion 9.
   *
   * Passed in rather than read here: this service is called from tests and
   * from a server action, and only one of those has a cookie jar.
   */
  attribution?: Attribution | null;
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
    categoryIds: await descendantsOf(input.categoryId),
    emirate: input.emirate ?? null,
    lineCount: input.lines.length,
    want: input.fanoutTo,
    ...(input.pinnedBusinessIds ? { pinned: input.pinnedBusinessIds } : {}),
  };

  const candidates = await findFanoutCandidates(request, now);
  const selection = selectRecipients(candidates, request);
  const skipped = selection.skipped;

  /*
     The buyer's choice, intersected with what the matcher would allow.

     Intersected rather than trusted: the ids arrive from a form and a seller
     who has hit their cap since the page rendered must still be excluded, or
     the cap is advisory. Nobody is added who was not ticked.

     That is what the comment said and not what the code did. It filtered
     `candidates` — the raw pool `findFanoutCandidates` returns, before any cap
     is applied — so the cap was advisory on the only path that matters:
     `RfqComposer` always sends `chosenBusinessIds`, so every enquiry from the
     composer took this branch. A capped seller got an `EnquiryRecipient` row
     and a `skipped` record for the same enquiry, and their monthly ceiling
     meant nothing.

     Excluded by `selection.skipped` rather than by `selection.recipients`.
     `recipients` is `ranked.slice(0, want)` — the top N the matcher would have
     picked on its own — and intersecting with that would silently drop a
     supplier the buyer deliberately ticked because they placed eleventh.
     `skipped` is the cap decision and nothing else, which is the only part of
     the matcher's judgement that should override the buyer's.
  */
  const capped = new Set(selection.skipped.map((s) => s.businessId));
  const recipients = input.chosenBusinessIds
    ? candidates
        .filter((c) => input.chosenBusinessIds!.includes(c.businessId) && !capped.has(c.businessId))
        .slice(0, MAX_RECIPIENTS)
    : selection.recipients;
  if (recipients.length === 0) return { ok: false, error: "no_recipients" };

  /*
     Resolve the landing slug the proxy stored into a campaign row.

     The proxy runs before any database client exists, so it stores the slug; a
     slug that no longer matches a campaign resolves to null rather than failing
     the enquiry, which is the right way round — losing attribution is a
     reporting gap, losing the enquiry is a lost customer.
  */
  const campaignId = input.attribution?.campaignSlug
    ? ((
        await prisma.campaign.findUnique({
          where: { slug: input.attribution.campaignSlug },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

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
        /*
           The emirate the composer already asked for, finally stored.

           `fanout` two hundred lines up has always routed on this — *"same
           emirate is a real delivery difference in the UAE, not a nicety"* —
           and the write kept only the free-text `deliverToArea` beside it. So
           the one piece of geography a buyer actually states was used to pick
           recipients and then thrown away, and board `3l`'s *"where enquiries
           come from"* panel had nothing left but a country guessed from an IP.

           A null is a real answer the panel renders as **Not stated**, not a
           gap to fill in with a guess.
        */
        emirate: (input.emirate as Emirate | null | undefined) ?? null,
        neededBy: input.neededBy ?? null,
        termsWanted: (input.termsWanted as never) ?? null,
        closesAt,
        /*
           Criterion 9. Whatever the buyer arrived tagged with, carried here by
           the cookie `lib/campaign/cookie.ts` set when they entered.

           On the row rather than in a side table because an enquiry has exactly
           one origin, and the console groups by it.
        */
        utmSource: input.attribution?.utmSource ?? null,
        utmMedium: input.attribution?.utmMedium ?? null,
        utmCampaign: input.attribution?.utmCampaign ?? null,
        campaignId,
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
   * Board 7d §4: route before anybody is told, so the notification can name the
   * seat it went to.
   *
   * Outside the transaction, for the same reason the carrier call is. Routing
   * reads, per recipient business, the mode, its eligible seats, their verified
   * channels and its opening hours — up to eight businesses' worth of that, on
   * an enquiry a buyer is waiting on.
   *
   * Each one is independent and each swallows its own failure: a business whose
   * routing cannot be decided keeps an unassigned lead, which every inbox scope
   * already renders, rather than costing the buyer the enquiry.
   */
  await Promise.all(
    recipients.map(async (r) => {
      try {
        await routeLead({ enquiryId: enquiry.id, businessId: r.businessId });
      } catch (cause) {
        console.error("[routing] failed", { enquiryId: enquiry.id, businessId: r.businessId, cause });
      }
    }),
  );

  /*
   * After the transaction, never inside it. A carrier being slow must not hold
   * a database transaction open, and a carrier being down must not roll back
   * an enquiry that was successfully delivered to eight inboxes.
   *
   * After routing too, and that ordering is load-bearing since board 7e: the
   * notification goes to the seat the router chose, and reading the assignment
   * before it was written would send every lead to the owner.
   */
  await onEnquiryDelivered({
    enquiryId: enquiry.id,
    businessIds: recipients.map((r) => r.businessId),
    valueAed: estimatedValueAed(input.lines),
  });

  /*
     Board 7e §4. The buyer hears something from a supplier whose counter is
     shut, inside the sixty seconds the board asks for, and the clock keeps
     running: `sendAutoReply` posts with `automatic: true`, which
     `lib/messaging/service.ts` refuses to let stamp `firstReplyAt`.
  */
  await sendAutoReplies({
    enquiryId: enquiry.id,
    businessIds: recipients.map((r) => r.businessId),
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
