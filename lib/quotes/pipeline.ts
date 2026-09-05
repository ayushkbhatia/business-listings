import "server-only";
import { prisma } from "@/lib/db/client";
import { buyerForSeller, type SellerVisibleBuyer } from "@/lib/db/queries/seller-visibility";
import type { LeadScope } from "@/lib/leads/inbox";
import { quoteTotalAed } from "@/lib/quote/money";

/**
 * Board 3k — the quotes pipeline.
 *
 * ## One row per lead, not one per revision
 *
 * §3: "One quote sits in exactly one state; a revision (`QT-8841-R2`) is a
 * version of one quote, not a second row." In this schema a revision *is* a new
 * `Quote` row — `sendQuoteForBusiness` never edits a sent one, because board 10h
 * shows the buyer both — so the pipeline groups by lead and renders the latest
 * revision. The superseded versions stay readable in the thread, which is where
 * board 11b puts them.
 *
 * That is also the reconciliation the 3j amendment describes: 53 leads, of which
 * 41 carry a quote, and that 41 is this screen's `All`.
 *
 * ## The count contract
 *
 * `Awaiting + Won + Lost + Expired = All`, with `Expiring soon` a filter over
 * Awaiting and excluded from the sum. Every bucket is computed here, once, from
 * one pass — rather than as six `where` clauses that can each be subtly wrong in
 * a different way. Board 3j shipped with three tabs reading zero because a
 * negated nullable column is NULL rather than true, and this is the shape that
 * makes an arithmetic check possible: `contractHolds` below states the sum, and
 * tests/integration/quotes-pipeline.test.ts asserts it against real rows.
 *
 * ## Where the outcome comes from
 *
 * The same two sources board 3j uses, in the same order: what the seller marked
 * first, then what the platform observed. `EnquiryRecipient.outcome` is the
 * seller's; `contactReleasedToBusinessId` and `state = declined` are the buyer's
 * acceptance of this supplier or of somebody else. The row says which, because
 * "you marked this won" and "the buyer accepted your quote" are different
 * sentences and only one of them is the seller's claim.
 *
 * An enquiry whose `closesAt` has simply passed is **not** an outcome. Board 3k
 * §10 describes a "buyer closed the RFQ" state, and nothing in the schema
 * records such an act — `closesAt` is a deadline the buyer set at the start, not
 * a decision they took later. A lead in that position has a window that ran out,
 * which is exactly what `Expired` means.
 */

export type PipelineTab = "all" | "awaiting" | "expiring" | "won" | "lost" | "expired";
export const PIPELINE_TABS = ["all", "awaiting", "expiring", "won", "lost", "expired"] as const;

/** The four that sum to `all`. `expiring` is a filter over `awaiting`. */
export type PipelineState = "awaiting" | "won" | "lost" | "expired";

/** §3: "Expiring soon — window closes within 7 days." */
export const EXPIRING_WINDOW_DAYS = 7;

export interface PipelineRow {
  quoteId: string;
  ref: string;
  revision: number;
  enquiryId: string;
  enquiryRef: string;
  buyer: SellerVisibleBuyer;
  /** The requirement's first sentence. Never a paraphrase. */
  summary: string;
  deliverToArea: string | null;
  lineCount: number;
  totalAed: string;
  sentAt: Date | null;
  expiresAt: Date | null;
  state: PipelineState;
  /** True when the buyer decided it rather than the seller marking it. */
  observed: boolean;
  outcomeReason: string | null;
  extensionCount: number;
  lastExtendedAt: Date | null;
  /** Board 11b's one follow-up, already spent on this lead. */
  followUpSpent: boolean;
  /** False once the enquiry itself has closed: there is nothing to re-quote. */
  enquiryOpen: boolean;
}

export interface PipelineCounts {
  all: number;
  awaiting: number;
  expiring: number;
  won: number;
  lost: number;
  expired: number;
}

export interface PipelinePage {
  rows: PipelineRow[];
  counts: PipelineCounts;
  /**
   * What the whole active tab is worth, not the page on screen.
   *
   * The header strip states it, and a strip that summed the visible rows would
   * quietly mean something different on page two — a total that changes as you
   * page through a list is a total nobody can quote to anybody.
   */
  quotedTotalAed: string;
  /** Rows in the active tab, so the footer can say what is shown. */
  total: number;
  page: number;
  pageSize: number;
}

export const PAGE_SIZE = 25;

/**
 * The bucketing pass.
 *
 * Deliberately small per row — an id, three dates and two enums — because it
 * reads every quoted lead this seller has in order to produce counts that must
 * add up. The heavy select happens afterwards, for the page actually rendered.
 */
interface Bucketed {
  enquiryId: string;
  quoteId: string;
  state: PipelineState;
  observed: boolean;
  expiresAt: Date | null;
  sentAt: Date | null;
  expiring: boolean;
}

function scopeWhere(scope: LeadScope) {
  switch (scope.kind) {
    case "all":
      return {};
    case "unassigned":
      return { assignedToId: null };
    case "mine":
    case "seat":
      return { assignedToId: scope.userId };
  }
}

async function bucket(
  businessId: string,
  scope: LeadScope,
  now: Date,
): Promise<Bucketed[]> {
  const recipients = await prisma.enquiryRecipient.findMany({
    where: {
      businessId,
      ...scopeWhere(scope),
      // A lead is in this pipeline once it carries a sent quote. A draft is the
      // seller's own workings and the buyer has never seen it.
      enquiry: { quotes: { some: { businessId, status: { not: "draft" } } } },
    },
    select: {
      enquiryId: true,
      state: true,
      outcome: true,
      enquiry: {
        select: {
          contactReleasedToBusinessId: true,
          quotes: {
            where: { businessId, status: { not: "draft" } },
            orderBy: { revision: "desc" },
            take: 1,
            select: { id: true, sentAt: true, expiresAt: true },
          },
        },
      },
    },
  });

  const expiringBefore = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000);

  return recipients.flatMap((r) => {
    const quote = r.enquiry.quotes[0];
    // `some` above guarantees one, but a narrowing that trusts a filter is a
    // narrowing that breaks the day somebody changes the filter.
    if (!quote) return [];

    const observedWin = r.enquiry.contactReleasedToBusinessId === businessId;
    const observedLoss = r.state === "declined";

    let state: PipelineState;
    let observed = false;
    if (r.outcome === "won") state = "won";
    else if (r.outcome === "lost") state = "lost";
    else if (observedWin) {
      state = "won";
      observed = true;
    } else if (observedLoss) {
      state = "lost";
      observed = true;
    } else if (quote.expiresAt && quote.expiresAt.getTime() <= now.getTime()) {
      state = "expired";
    } else {
      state = "awaiting";
    }

    return [
      {
        enquiryId: r.enquiryId,
        quoteId: quote.id,
        state,
        observed,
        expiresAt: quote.expiresAt,
        sentAt: quote.sentAt,
        expiring:
          state === "awaiting" &&
          quote.expiresAt !== null &&
          quote.expiresAt.getTime() <= expiringBefore.getTime(),
      },
    ];
  });
}

function countsOf(rows: readonly Bucketed[]): PipelineCounts {
  const counts: PipelineCounts = {
    all: rows.length,
    awaiting: 0,
    expiring: 0,
    won: 0,
    lost: 0,
    expired: 0,
  };
  for (const row of rows) {
    counts[row.state] += 1;
    if (row.expiring) counts.expiring += 1;
  }
  return counts;
}

/**
 * §3's contract, as an assertion rather than a comment.
 *
 * Exported so the tests can state it in the same words the spec does. A screen
 * whose tabs do not sum is a screen a seller stops trusting, and board 3j proved
 * that four filters written separately drift separately.
 */
export function contractHolds(counts: PipelineCounts): boolean {
  return counts.awaiting + counts.won + counts.lost + counts.expired === counts.all;
}

function inTab(row: Bucketed, tab: PipelineTab): boolean {
  if (tab === "all") return true;
  if (tab === "expiring") return row.expiring;
  return row.state === tab;
}

/** The first sentence of the requirement, for a row that must not wrap twice. */
function summarise(requirement: string): string {
  const flat = requirement.replace(/\s+/g, " ").trim();
  const stop = flat.search(/[.?!]\s/);
  const first = stop > 0 ? flat.slice(0, stop) : flat;
  return first.length > 110 ? `${first.slice(0, 109).trimEnd()}…` : first;
}

export async function getPipeline(input: {
  businessId: string;
  tab: PipelineTab;
  scope: LeadScope;
  page?: number;
  now?: Date;
}): Promise<PipelinePage> {
  const now = input.now ?? new Date();
  const all = await bucket(input.businessId, input.scope, now);
  const counts = countsOf(all);

  /*
     Newest sent first. §4 is explicit that it is not urgency-ordered: the
     expiring card already names the three that need action, and a table that
     reorders itself under the seller while they work down it is worse than one
     that does not.
  */
  const inThisTab = all
    .filter((row) => inTab(row, input.tab))
    .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));

  const page = Math.max(1, input.page ?? 1);
  const slice = inThisTab.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const [rows, quotedTotalAed] = await Promise.all([
    hydrate(input.businessId, slice, now),
    totalOf(inThisTab),
  ]);

  return {
    rows,
    counts,
    quotedTotalAed,
    total: inThisTab.length,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * What a tab is worth, in one query.
 *
 * Line totals only — no buyer, no requirement, no dates. The strip states a
 * figure over the whole tab, so it has to read the whole tab; keeping the select
 * to two columns is what makes that affordable.
 */
async function totalOf(rows: readonly Bucketed[]): Promise<string> {
  if (rows.length === 0) return "0.00";
  const quotes = await prisma.quote.findMany({
    where: { id: { in: rows.map((row) => row.quoteId) } },
    select: { lines: { select: { qty: true, unitPrice: true } } },
  });
  return quoteTotalAed(
    quotes.flatMap((q) => q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() }))),
  );
}

/** The heavy select, for the page actually on screen. */
async function hydrate(
  businessId: string,
  slice: readonly Bucketed[],
  now: Date,
): Promise<PipelineRow[]> {
  if (slice.length === 0) return [];

  const quotes = await prisma.quote.findMany({
    where: { id: { in: slice.map((row) => row.quoteId) } },
    select: {
      id: true,
      ref: true,
      revision: true,
      enquiryId: true,
      sentAt: true,
      expiresAt: true,
      extensionCount: true,
      lastExtendedAt: true,
      lines: { select: { qty: true, unitPrice: true } },
      enquiry: {
        select: {
          ref: true,
          requirement: true,
          deliverToArea: true,
          closesAt: true,
          contactReleasedToBusinessId: true,
          buyer: { select: { fullName: true } },
        },
      },
    },
  });

  const recipients = await prisma.enquiryRecipient.findMany({
    where: { businessId, enquiryId: { in: slice.map((row) => row.enquiryId) } },
    select: { enquiryId: true, sellerNudgedAt: true, outcomeReason: true },
  });
  const byEnquiry = new Map(recipients.map((r) => [r.enquiryId, r]));
  const byQuote = new Map(quotes.map((q) => [q.id, q]));

  return slice.flatMap((row) => {
    const quote = byQuote.get(row.quoteId);
    const recipient = byEnquiry.get(row.enquiryId);
    if (!quote) return [];

    return [
      {
        quoteId: quote.id,
        ref: quote.ref,
        revision: quote.revision,
        enquiryId: quote.enquiryId,
        enquiryRef: quote.enquiry.ref,
        buyer: buyerForSeller(
          quote.enquiry.buyer,
          quote.enquiry.contactReleasedToBusinessId,
          businessId,
        ),
        summary: summarise(quote.enquiry.requirement),
        deliverToArea: quote.enquiry.deliverToArea,
        lineCount: quote.lines.length,
        totalAed: quoteTotalAed(
          quote.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() })),
        ),
        sentAt: quote.sentAt,
        expiresAt: quote.expiresAt,
        state: row.state,
        observed: row.observed,
        outcomeReason: recipient?.outcomeReason ?? null,
        extensionCount: quote.extensionCount,
        lastExtendedAt: quote.lastExtendedAt,
        followUpSpent: recipient?.sellerNudgedAt !== null && recipient?.sellerNudgedAt !== undefined,
        enquiryOpen: quote.enquiry.closesAt.getTime() > now.getTime(),
      },
    ];
  });
}

/**
 * §7's right-hand card: the quotes actually expiring, in window order.
 *
 * The only urgency-ordered surface on the screen, and the replacement for the
 * board's `Follow up on all 6` — an act on three named quotes rather than a
 * button over six. Three, because the card is the size it is; the tab carries
 * the rest.
 */
export async function expiringSoon(input: {
  businessId: string;
  scope: LeadScope;
  take?: number;
  now?: Date;
}): Promise<PipelineRow[]> {
  const now = input.now ?? new Date();
  const all = await bucket(input.businessId, input.scope, now);
  const soon = all
    .filter((row) => row.expiring)
    .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
    .slice(0, input.take ?? 3);
  return hydrate(input.businessId, soon, now);
}

/** One row, by reference. The deep link `/dashboard/quotes/:ref` reads this. */
export async function findByRef(
  businessId: string,
  ref: string,
  now: Date = new Date(),
): Promise<PipelineRow | null> {
  const quote = await prisma.quote.findFirst({
    where: { businessId, ref, status: { not: "draft" } },
    select: { id: true, enquiryId: true },
  });
  if (!quote) return null;

  const all = await bucket(businessId, { kind: "all" }, now);
  const row = all.find((r) => r.enquiryId === quote.enquiryId);
  if (!row) return null;

  const [hydrated] = await hydrate(businessId, [row], now);
  return hydrated ?? null;
}
