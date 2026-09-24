import "server-only";
import type { BriefStart, Emirate, EngagementType, Prisma, ServiceCadence } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { tradeKindFor } from "@/lib/taxonomy/service";
import { createProvisionalIdentity } from "@/lib/auth/flow";
import { actorFor } from "@/lib/auth/actor";
import { assertCanAcceptQuote, assertCanCreateEnquiry } from "@/lib/auth/guards";
import { normaliseIdentifier } from "@/lib/auth/identity";
import { routeLead } from "@/lib/leads/router";
import { sendAutoReplies } from "@/lib/messaging/auto-reply";
import { onEnquiryDelivered, onQuoteAccepted, onQuotesDeclined } from "@/lib/notify/events";
import { recordEvent } from "@/lib/telemetry/record";
import { quoteTotalAed } from "@/lib/quote/money";
import { resolveEnquiryArea } from "./area";
import { gateCompanyAcceptance, GateRefused, readReference, type GateRefusal } from "@/lib/buyer-company/gate";
import { activeMembership } from "@/lib/buyer-company/store";
import { snapshotOf } from "@/lib/buyer-company/address";
import { PLAN_CAPS_SELECT, effectiveCaps, toCaps } from "@/lib/plan/entitlements";
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
 *
 * And both ask the matrix first — `enquiry.create`, `quote.accept` — of the
 * actor the record holds for that id (`actorFor`), so the question is asked on
 * every path into them rather than on the screens that happen to offer them.
 * Before build plan 9.4 neither did, and the guards for both had no caller.
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
    /*
       The whole cap set, not the two columns this file used to read.

       It read `plan.enquiriesPerMonth` straight off the live `Plan` row, which
       is the one thing D1's entitlement snapshot exists to prevent: a
       grandfathered seller was capped at whatever number staff last typed into
       the plan editor rather than the number they signed up on. The snapshot
       has been written since handoff 3 and this — the reader that decides
       whether a seller is shown an enquiry at all — never looked at it.

       `rankingMultiplier` is deliberately still the live plan's, and
       `effectiveCaps` keeps it that way: its docblock says the name, the price
       and the multiplier are facts about the plan today, not about what
       somebody bought.
    */
    plan: { select: PLAN_CAPS_SELECT },
    subscription: { select: { entitlementSnapshot: true } },
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

/**
 * The requested categories an RFQ may fan out to — board 4d's "Allow RFQ
 * fan-outs".
 *
 * A category with the switch off, or under a sector with it off, drops out of
 * category matching. It had one reader before this, the service brief, which
 * refused the brief outright; a goods RFQ into the same trade fanned out as if
 * the switch did not exist.
 *
 * Only the fan-out. A supplier the buyer named is still a recipient, because
 * sending an enquiry to a firm you chose is not a fan-out and nothing on the
 * switch says otherwise.
 */
export async function rfqOpenCategoryIds(categoryIds: readonly string[]): Promise<string[]> {
  if (categoryIds.length === 0) return [];
  const rows = await prisma.category.findMany({
    where: { id: { in: [...new Set(categoryIds)] } },
    select: { id: true, acceptsRfq: true, parent: { select: { acceptsRfq: true } } },
    orderBy: [{ id: "asc" }],
  });
  return rows.filter((row) => row.acceptsRfq && (row.parent?.acceptsRfq ?? true)).map((row) => row.id);
}

export async function findFanoutCandidates(
  request: FanoutRequest & { excludeBusinessIds?: readonly string[] },
  now: Date = new Date(),
): Promise<FanoutCandidate[]> {
  const since = monthStart(now);

  const pinned = [...(request.pinned ?? [])];
  const open = await rfqOpenCategoryIds(request.categoryIds);

  const businesses = await prisma.business.findMany({
    where: {
      ...PUBLIC_BUSINESS,
      claimStatus: "claimed",
      ...(request.excludeBusinessIds?.length
        ? { id: { notIn: [...request.excludeBusinessIds] } }
        : {}),
      OR: [
        { primaryCategoryId: { in: open } },
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
              categoryId: { in: open },
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
  const candidateIds = businesses.map((business) => business.id);
  const [delivery, work] = await Promise.all([
    prisma.businessCoverage.groupBy({
      by: ["businessId", "emirate"],
      where: { businessId: { in: candidateIds } },
    }),
    /*
       Board `2d-s` B6, the half of it that exists today.

       `ServiceCoverage` is the other coverage table, and it is the only one a
       firm that sells work ever writes. Without this a consultancy that named
       all seven emirates on the coverage step reaches the locality term with an
       empty set and scores `UNMEASURED` — the same as a listing that has said
       nothing at all, which is the one thing the screen was asking them not to
       be.

       The `coverage * 0.34` term above it still reads *does this business have
       any products*, and replacing that with geographic match is `1h-s`, not
       this. This is the locality term, and it is a different number.
    */
    /*
       Both kinds of row — the default and `3c-s`'s per-service narrowings —
       and deliberately not filtered to `serviceId: null`. The question here is
       "does this business reach this emirate at all", and a firm whose audit
       service travels to Fujairah reaches Fujairah whether or not the default
       says so.

       It over-claims in exactly one shape: a default wider than every
       published service's narrowing. That is B6's union, it needs the
       published-services join this matcher does not do, and it is `1h-s` —
       the same note the term above carries. Including the service rows does
       not make it worse; the default alone was already the wider reading.
    */
    prisma.serviceCoverage.groupBy({
      by: ["businessId", "emirate"],
      where: { businessId: { in: candidateIds } },
    }),
  ]);
  const coveredBy = new Map<string, string[]>();
  for (const row of [...delivery, ...work]) {
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
    /*
       D1's grandfathering, finally read. `effectiveCaps` prefers the caps this
       subscription was signed up on and falls back to the live plan where
       nothing was frozen — the same one rule billing and the plan console use,
       rather than a fourth reading of it here.

       No plan at all is no cap, which is what it has always meant: a listing
       with no plan row is not on a metered tier.
    */
    enquiriesPerMonth: business.plan
      ? effectiveCaps(toCaps(business.plan), business.subscription?.entitlementSnapshot)
          .enquiriesPerMonth
      : null,
    enquiriesThisMonth: business._count.recipients,
    rankingMultiplier: business.plan ? Number(business.plan.rankingMultiplier) : 1,
  }));
}

export interface EnquiryLineInput {
  description: string;
  /**
   * Null is unquantified — work sold as a job, `1d-s`'s service line — and the
   * column has allowed it since pull request 173. Every goods composer still sends a number.
   */
  qty: number | null;
  /** The product the buyer was looking at, where they were looking at one. */
  productId?: string | null;
  unit?: string | null;
  size?: string | null;
  /** The buyer's own budget per unit. Never a supplier price. */
  targetUnitPriceAed?: string | null;
  /**
   * The service this line asks about — board `1d-s` B11, the service-side twin
   * of `productId`. Checked against the recipients below rather than trusted.
   */
  serviceId?: string | null;
}

export interface CreateEnquiryInput {
  /** Null for a buyer with no account. One is created for them. */
  buyerId: string | null;
  /** Required when there is no buyerId: the lightweight identity is built on it. */
  phone?: string | null;
  fullName?: string | null;
  /**
   * The company this enquiry is raised for. Omitted, it is the buyer's own
   * active company — board `7b`: an enquiry a member sends is the company's to
   * approve. Passed explicitly only by fixtures.
   */
  buyerCompanyId?: string | null;
  /**
   * Board `7b` `B6`: one of the company's saved delivery addresses. Its
   * emirate and area route the fan-out, and a snapshot of it travels on the
   * enquiry. Ignored when it is not an active address of the buyer's company —
   * the emirate and area the form also posts still say where.
   */
  deliveryAddressId?: string | null;

  requirement: string;
  lines: EnquiryLineInput[];
  categoryId: string;
  emirate?: string | null;
  deliverToArea?: string | null;
  neededBy?: Date | null;
  termsWanted?: string | null;
  /** How big the job is, in the buyer's words — decision D7. Service enquiries only. */
  scale?: string | null;
  /** How long sellers have. Board 1h's third step. */
  closesInDays?: number;
  /**
   * Board 10e `B3`: the expired enquiry this one re-sends. Written as given —
   * callers pass it through `resendSourceIdFor`, which checks it belongs to this
   * buyer, has closed unaccepted, and has not been re-sent already.
   */
  resentFromId?: string | null;

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

  /**
   * Board `1h-s`: who it goes to, already decided.
   *
   * A brief is matched on a different criterion from a parts list — a verified
   * licence, the trade, and coverage of the site — by `lib/enquiry/service-brief`,
   * and running the goods ranking over the top of that answer would re-pick on
   * stock signals a firm that sells work does not have. When this is set the
   * goods matcher does not run and `chosenBusinessIds` / `fanoutTo` are
   * ignored; the recipients and the cap skips are written exactly as given.
   */
  selection?: {
    recipients: readonly EnquiryRecipientSummary[];
    skipped: FanoutResult["skipped"];
  };
  /**
   * Board `1h-s`: the brief itself, written in the same transaction as the
   * enquiry so an enquiry for work can never exist without one.
   */
  serviceBrief?: {
    categoryId: string;
    engagementType: EngagementType;
    cadence: ServiceCadence | null;
    startMode: BriefStart;
    startsOn: Date | null;
    building: string | null;
  };
  /**
   * The area the buyer **picked**, written directly — `1h-s`'s site select.
   * `resolveEnquiryArea` is for typed text; running it over a name the buyer
   * chose from our own list could only lose information.
   */
  areaId?: string | null;
}

/** What a caller learns about each firm the enquiry reached. */
export type EnquiryRecipientSummary = Pick<FanoutCandidate, "businessId" | "slug" | "displayName">;

export type CreateEnquiryResult =
  | {
      ok: true;
      enquiryId: string;
      ref: string;
      recipients: EnquiryRecipientSummary[];
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
  /*
     Build plan 9.4 — `enquiry.create`, first, for a sender who is somebody.
     Throws `PermissionError`: a staff seat with no buyer role is refused here
     however the request reached this function (§07: moderator —, superadmin —).
  */
  if (input.buyerId) assertCanCreateEnquiry(await actorFor(input.buyerId));

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

    /*
       And again for the identity the number resolved to, before anything is
       written against it. Usually that is the provisional one just made, which
       holds `enquiry.create` by name. But a number already on an account sends
       as that account — two people cannot share a mobile — and is asked the
       same question a signed-in send is, or a signed-out one would be the way
       round it. A suspended provisional identity holds nothing, so suspending
       one is what stops its number sending.
    */
    assertCanCreateEnquiry(await actorFor(buyerId));

    const provisional = await prisma.user.findUnique({
      where: { id: buyerId },
      select: { claimToken: true, isProvisional: true },
    });
    claimToken = provisional?.isProvisional ? provisional.claimToken : null;
  }

  /*
     Board `7b`. The company is the sender's, read from the membership record —
     an enquiry a member sends is one their company's rule governs when a quote
     comes back. A provisional buyer has no membership, so no company.
  */
  const buyerCompanyId =
    input.buyerCompanyId !== undefined
      ? input.buyerCompanyId
      : input.buyerId
        ? ((await activeMembership(prisma, buyerId))?.companyId ?? null)
        : null;
  const delivery =
    buyerCompanyId && input.deliveryAddressId
      ? await prisma.buyerDeliveryAddress.findFirst({
          where: { id: input.deliveryAddressId, companyId: buyerCompanyId, archivedAt: null },
          select: {
            id: true,
            label: true,
            addressLine: true,
            emirate: true,
            areaId: true,
            area: { select: { name: true } },
            attnName: true,
            attnPhone: true,
            accessPoint: true,
            accessFrom: true,
            accessUntil: true,
            loadLimit: true,
          },
        })
      : null;
  /*
     A saved address decides where, for the matcher as much as for the record:
     its emirate routes the fan-out and its area is a picked row, not typed text
     for `resolveEnquiryArea` to guess at.
  */
  const located: CreateEnquiryInput = delivery
    ? {
        ...input,
        emirate: delivery.emirate,
        deliverToArea: input.deliverToArea?.trim() || delivery.area?.name || null,
        areaId: delivery.areaId,
      }
    : input;

  const { recipients, skipped } = located.selection
    ? { recipients: [...located.selection.recipients], skipped: located.selection.skipped }
    : await matchGoods(located, now);
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

  /*
     A line's service, kept only where it is a live service of a business this
     enquiry actually reaches.

     The id arrives from a form. Trusting it would let a buyer's enquiry to one
     firm name another firm's service as its subject — and `EnquiryLine.serviceId`
     is what the seller's inbox and, later, `3l`'s funnel will read as *which of
     my services was asked about*. One query, and only when a line carries one.
  */
  const askedServices = input.lines.flatMap((line) => (line.serviceId ? [line.serviceId] : []));
  const ownServices = new Set(
    askedServices.length === 0
      ? []
      : (
          await prisma.service.findMany({
            where: {
              id: { in: askedServices },
              status: "live",
              businessId: { in: recipients.map((r) => r.businessId) },
            },
            select: { id: true },
          })
        ).map((row) => row.id),
  );

  /*
     The typed area, resolved to an `Area` row where it resolves to one at all.

     Read here rather than inside the transaction, because it is a lookup
     against a staff-curated taxonomy and not part of what has to be atomic
     with the write. Scoped to the emirate the buyer stated, so
     "Industrial Area 1" on a Sharjah enquiry cannot come back as Ajman's.

     Null is the ordinary answer and it is a real one. `resolveEnquiryArea`
     refuses prefixes and refuses ambiguity, because the id it produces is what
     lets a seller covering only Al Quoz be matched — a bad resolve sends the
     job to somebody who does not work there.
  */
  const areaId = located.areaId !== undefined
    ? located.areaId
    : located.deliverToArea
    ? resolveEnquiryArea(
        located.deliverToArea,
        located.emirate ?? null,
        await prisma.area.findMany({ select: { id: true, name: true, emirate: true } }),
      )
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
        buyerCompanyId,
        ...(delivery
          ? {
              deliveryAddressId: delivery.id,
              deliverySnapshot: snapshotOf(
                {
                  label: delivery.label,
                  addressLine: delivery.addressLine,
                  emirate: delivery.emirate,
                  areaId: delivery.areaId,
                  attnName: delivery.attnName,
                  attnPhone: delivery.attnPhone,
                  accessPoint: delivery.accessPoint,
                  accessFrom: delivery.accessFrom,
                  accessUntil: delivery.accessUntil,
                  loadLimit: delivery.loadLimit,
                },
                delivery.area?.name ?? null,
              ) as unknown as Prisma.InputJsonValue,
            }
          : {}),
        /*
           A brief keeps the description byte for byte — `1h-s` B2, *suppliers
           see this exactly as you write it*. The goods composer's trim stays
           where it was: a parts-list note has never promised otherwise.
        */
        requirement: input.serviceBrief ? input.requirement : input.requirement.trim(),
        // What the buyer wrote, kept as they wrote it — and beside it the row
        // it resolves to, which is a different claim and often null.
        deliverToArea: located.deliverToArea ?? null,
        areaId,
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
        emirate: (located.emirate as Emirate | null | undefined) ?? null,
        neededBy: input.neededBy ?? null,
        termsWanted: (input.termsWanted as never) ?? null,
        scale: input.scale?.trim() ? input.scale.trim() : null,
        closesAt,
        resentFromId: input.resentFromId ?? null,
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
            serviceId: line.serviceId && ownServices.has(line.serviceId) ? line.serviceId : null,
            unit: line.unit ?? null,
            size: line.size ?? null,
            targetUnitPriceAed: line.targetUnitPriceAed ?? null,
            sortOrder: i,
          })),
        },
        ...(input.serviceBrief ? { serviceBrief: { create: input.serviceBrief } } : {}),
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
 * The goods matcher, and the buyer's picker over it — every enquiry that did not
 * arrive with its recipients already chosen.
 */
async function matchGoods(
  input: CreateEnquiryInput,
  now: Date,
): Promise<{ recipients: EnquiryRecipientSummary[]; skipped: FanoutResult["skipped"] }> {
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
  return { recipients, skipped: selection.skipped };
}

/**
 * What the enquiry is roughly worth, for the quiet-hours override.
 *
 * From the buyer's own target prices, which are the only numbers an enquiry
 * carries — there are no supplier prices yet, by definition. A line with no
 * target contributes nothing, so this reads low rather than high, and a seller
 * woken at midnight was woken for an enquiry that really is large.
 */
export function estimatedValueAed(
  lines: readonly Pick<EnquiryLineInput, "qty" | "targetUnitPriceAed">[],
): number | null {
  let total = 0;
  let known = false;
  for (const line of lines) {
    const target = Number(line.targetUnitPriceAed);
    if (Number.isFinite(target) && target > 0) {
      // An unquantified line is one of whatever it is — the same reading
      // `lineTotalFils` takes on the quote side.
      total += target * (line.qty ?? 1);
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
  | {
      ok: false;
      error:
        | "not_found"
        | "not_yours"
        | "already_accepted"
        | "quote_expired"
        /** Lost, expired by the sweep, or a draft — not a quote a buyer holds. */
        | "not_open"
        /** The supplier has sent a later revision; accept that one. */
        | "revised"
        /** Board 11i. The supplier closed their account. */
        | "supplier_closed"
        /**
         * The enquiry closed before anybody accepted. Board `10e` `B3`: expired
         * is terminal with one action, re-send — and board `10h`'s states make
         * the thread read-only at the same moment. Accepting past it would
         * release a buyer's contact on an enquiry every other screen calls dead.
         */
        | "enquiry_closed"
        /**
         * Board `7b`. The enquiry was raised for a buying company and its rule
         * refused this acceptance — see `lib/buyer-company/gate.ts`.
         */
        | GateRefusal;
    };

/**
 * Board `7b`. What a company acceptance carries, and — from the approval
 * queue — which request it is the approval of.
 */
export interface AcceptOptions {
  /** Written to `Enquiry.buyerReference` with the acceptance. */
  poNumber?: string | null;
  costCode?: string | null;
  approval?: { id: string; approverId: string } | null;
  /**
   * Which screen the acceptance was pressed on, for the `quote_accepted` event
   * only — board `1n`'s telemetry asks whether buyers decide on the comparison
   * or in a thread. It changes nothing about what accepting does (`10h` B6).
   */
  source?: "compare" | "thread" | "company" | "approval";
}

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
/** A refusal found under the lock, thrown so the claim rolls back with it. */
class AcceptRefused extends Error {
  constructor(readonly code: "not_open" | "revised" | "enquiry_closed" | GateRefusal) {
    super(code);
  }
}

export async function acceptQuote(
  buyerId: string,
  quoteId: string,
  now: Date = new Date(),
  options: AcceptOptions = {},
): Promise<AcceptQuoteResult> {
  /*
     Build plan 9.4 — `quote.accept`, before the quote is read, of the person
     the acceptance goes out in the name of. Throws `PermissionError`. From the
     company approval queue that is the colleague who raised the request;
     `approveRequest` asks the approver as well, before it gets here. Whether
     the enquiry is theirs is the row's question, answered below.
  */
  assertCanAcceptQuote(await actorFor(buyerId));

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      businessId: true,
      ref: true,
      revision: true,
      status: true,
      expiresAt: true,
      business: { select: { closureRequestedAt: true } },
      enquiry: {
        select: { id: true, buyerId: true, buyerCompanyId: true, contactReleasedToBusinessId: true, closesAt: true },
      },
    },
  });
  if (!quote) return { ok: false, error: "not_found" };
  // Somebody else's enquiry and a missing one are the same answer.
  if (quote.enquiry.buyerId !== buyerId) return { ok: false, error: "not_found" };
  // A draft is invisible to the buyer, so an id for one is a guessed id.
  if (quote.status === "draft") return { ok: false, error: "not_found" };
  if (quote.enquiry.contactReleasedToBusinessId) return { ok: false, error: "already_accepted" };
  if (quote.enquiry.closesAt.getTime() <= now.getTime()) return { ok: false, error: "enquiry_closed" };
  if (quote.expiresAt && quote.expiresAt.getTime() < now.getTime()) {
    return { ok: false, error: "quote_expired" };
  }
  /*
     Board 11i. Accepting releases the buyer's contact details to a supplier and
     tells every other supplier the enquiry is closed — to a business with no
     team left to receive them. An owner cannot close with a quote outstanding
     (B1), but a platform closure can take effect over one.
  */
  if (quote.business.closureRequestedAt) return { ok: false, error: "supplier_closed" };

  const accepted = await prisma.$transaction(async (tx) => {
    /*
       Board `7c`: the claim is conditional, and it is the lock.

       This was an unconditional update after a read made outside the
       transaction, so two accepts a second apart — two tabs, a double tap on a
       slow connection — both passed the read and both committed: contact
       released to one supplier, then to the other, and two quotes marked
       accepted on one enquiry. The terminal state of the product, reached twice.

       `updateMany` with the null in its `where` takes the row lock and re-reads
       the column under it, so the second accept waits for the first and then
       matches nothing. It is also the lock `lockQuoteFence` waits on, which is
       what stops a supplier's send landing between the two.
    */
    const claimed = await tx.enquiry.updateMany({
      where: { id: quote.enquiry.id, contactReleasedToBusinessId: null },
      data: {
        contactReleasedToBusinessId: quote.businessId,
        contactReleasedAt: now,
      },
    });
    if (claimed.count === 0) return { ok: false as const, error: "already_accepted" as const };

    /*
       Read again under the lock. A sweep can expire the quote, and a supplier
       can send revision 3, between the page the buyer pressed on and this
       instant — and accepting revision 2 once revision 3 exists would fix as
       the record a price the supplier has already replaced. Throwing rolls the
       claim back with it; the caller turns the code into the refusal.
    */
    const current = await tx.quote.findUniqueOrThrow({
      where: { id: quote.id },
      select: { status: true, enquiry: { select: { closesAt: true } } },
    });
    if (current.status !== "sent" && current.status !== "read") {
      throw new AcceptRefused("not_open");
    }
    // A revision of the requirement can move the close; read it where the claim holds.
    if (current.enquiry.closesAt.getTime() <= now.getTime()) throw new AcceptRefused("enquiry_closed");
    const later = await tx.quote.count({
      where: {
        enquiryId: quote.enquiry.id,
        businessId: quote.businessId,
        revision: { gt: quote.revision },
        status: { not: "draft" },
      },
    });
    if (later > 0) throw new AcceptRefused("revised");

    /*
       Board `7b`: an enquiry raised for a buying company passes its rule here,
       under the claim — the threshold, the person's authority and the month's
       spend are read under the company's lock, so the gate and the claim are
       one decision. A refusal throws and the claim rolls back with it.

       The company is the enquiry's, not the buyer's today: an enquiry raised
       for Marina Facilities is Marina's to approve even if the person who sent
       it has since moved on — and then nobody accepts it in Marina's name.
    */
    if (quote.enquiry.buyerCompanyId) {
      const po = readReference(options.poNumber);
      const cost = readReference(options.costCode);
      if (po === "too_long" || po === "invalid" || cost === "too_long" || cost === "invalid") {
        throw new AcceptRefused("reference_invalid");
      }
      const gated = await gateCompanyAcceptance(tx, {
        companyId: quote.enquiry.buyerCompanyId,
        enquiryId: quote.enquiry.id,
        quoteId: quote.id,
        quoteRef: quote.ref,
        raiserId: buyerId,
        now,
        poNumber: po,
        costCode: cost,
        approval: options.approval ?? null,
      }).catch((error: unknown) => {
        if (error instanceof GateRefused) throw new AcceptRefused(error.code);
        throw error;
      });
      await tx.enquiry.update({
        where: { id: quote.enquiry.id },
        data: {
          ...(gated.poNumber ? { buyerReference: gated.poNumber } : {}),
          ...(gated.costCode ? { costCode: gated.costCode } : {}),
        },
      });
    }

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
  }).catch((error: unknown) => {
    if (error instanceof AcceptRefused) return { ok: false as const, error: error.code };
    throw error;
  });

  if (accepted.ok) {
    const [total, proposal] = await Promise.all([
      prisma.quoteLine.findMany({
        where: { quoteId: quote.id },
        select: { qty: true, unitPrice: true },
      }),
      prisma.quoteProposal.findUnique({
        where: { quoteId: quote.id },
        select: { feeAed: true, feeBasisLabel: true },
      }),
    ]);
    await onQuoteAccepted({
      enquiryId: accepted.enquiryId,
      businessId: accepted.businessId,
      quoteRef: quote.ref,
      totalAed: quoteTotalAed(total.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() }))),
      /*
         Board `3j-s`: an accepted proposal's figure is its fee on its basis. The
         line sum is `0.00` and would tell the supplier they won nothing.
      */
      ...(proposal?.feeAed && proposal.feeBasisLabel
        ? { proposal: { feeAed: proposal.feeAed.toString(), feeBasisLabel: proposal.feeBasisLabel } }
        : {}),
    });
    /*
       Board `1n` `B8`: the quotes that lost are declined out loud, not by a
       status change nobody reads. Here rather than in any one screen's action,
       because this is the only way to an acceptance — the comparison, the
       thread and an approval all arrive through it.
    */
    await onQuotesDeclined({ enquiryId: accepted.enquiryId, acceptedBusinessId: accepted.businessId });
    await recordEvent({
      name: "quote_accepted",
      businessId: accepted.businessId,
      actorId: options.approval?.approverId ?? buyerId,
      props: { source: options.source ?? "compare", lines: total.length, proposal: proposal !== null },
    });
  }

  return accepted;
}

export { CLOSES_IN_DAYS_CHOICES, MAX_RECIPIENTS };
