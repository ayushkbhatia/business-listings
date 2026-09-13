import "server-only";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import type { $Enums } from "@/lib/db/generated/client";

/**
 * Board 12d — the call list that builds itself.
 *
 * *"The CRM call list builds itself from demand signals — a held area page, a
 * zero-result query, a Free account hitting its cap, a paying account whose
 * reply rate is falling. Nobody types a prospect list by hand."*
 *
 * So this is a **query**, not a table. That is the whole design: criterion 7
 * asks that the list be generated with no manual entry, and the way to make
 * that true rather than merely intended is to give it nowhere to type. There is
 * no `CallTask` model, no insert path, and no screen that adds a row — only
 * `CallOutcome`, which records what happened once somebody rang.
 *
 * ## The script the board says works
 *
 * *"Lead with their missed demand, not with our product."* Every prospect
 * carries the signal that put them on the list and the number attached to it,
 * because "eleven buyers searched for what you sell in Al Quoz last month and
 * found nobody" is a different call from "would you like to hear about Pro".
 *
 * Every signal here is already being written by code that shipped in handoffs
 * 1 and 2 and read by nothing: `ZeroResultQuery` since the search step,
 * `MissedEnquiry` since the fan-out. This is the reader.
 */

/**
 * Why a prospect is on the list. Three, and each has a producer below.
 *
 * `reply_rate_falling` was a fourth with a label in the catalogue, a place in
 * this union and nothing anywhere that could ever set it — the same shape as
 * `spec_field_proposal`, the table with a reader and no writer, dropped in
 * `d5455a8`. A signal a caller can never be shown is a promise the list does
 * not keep; it comes back with the query that produces it.
 */
export type SignalKey =
  | "missed_at_cap"
  | "zero_result_in_their_trade"
  | "unclaimed_with_demand";

export interface Prospect {
  businessId: string;
  displayName: string;
  slug: string;
  claimStatus: string;
  planId: string | null;
  /** Why they are on the list. */
  signal: SignalKey;
  /** The number the call opens with. */
  value: number;
  /** Already-localised detail is the caller's job; this is the raw fact. */
  detail: string;
  /** Most recent call, so nobody rings twice in a week. */
  lastCalledAt: Date | null;
  lastOutcome: $Enums.CallOutcomeKind | null;
}

const RECENTLY_CALLED_DAYS = 7;

/**
 * How deep the signal queries read, and deliberately not the screen's limit.
 *
 * `take: limit` sat on every source query, so the number a *screen* wanted to
 * show decided which signals were considered at all: the console metric asked
 * for 500 and the page asked for 200, and the two were computed over different
 * candidate pools. Worse, the page then printed `rows.length` — its own page
 * cap — as "N prospects, from demand we measured", which is a constant wearing
 * a measurement's clothes.
 *
 * Two thousand per signal is far above anything the platform produces at 41,000
 * listings, and `truncated` says so honestly when it is not.
 */
const SIGNAL_SCAN = 2000;

export interface CallList {
  /** The page, at whatever size the caller asked for. */
  prospects: Prospect[];
  /** How many the signals actually produced, before that limit. */
  total: number;
  /** True when a signal query filled `SIGNAL_SCAN`, so `total` is a floor. */
  truncated: boolean;
}

/**
 * Build the list.
 *
 * Ordered by the size of the missed demand rather than by account value: a Free
 * seller who lost eleven enquiries is a better call than a Pro seller who lost
 * one, and sorting by what we would earn is how a CRM stops being about the
 * customer.
 */
export async function callList(limit = 100, now = new Date()): Promise<CallList> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const calledSince = new Date(now.getTime() - RECENTLY_CALLED_DAYS * 86_400_000);

  const [missed, zeroResults, unclaimed, recentCalls] = await Promise.all([
    /*
     * A Free account that hit its cap. `MissedEnquiry` rows are written by the
     * fan-out when `atMonthlyCap` fires — real enquiries, with real dates and
     * real requirements, that this seller did not get to see.
     */
    prisma.missedEnquiry.groupBy({
      by: ["businessId"],
      where: { createdAt: { gte: since }, reason: "at_monthly_cap" },
      _count: true,
      orderBy: [{ _count: { businessId: "desc" } }, { businessId: "asc" }],
      take: SIGNAL_SCAN,
    }),

    // Searches that found nobody, by category. Demand with no supply behind it.
    prisma.zeroResultQuery.groupBy({
      by: ["categoryId"],
      where: { createdAt: { gte: since }, categoryId: { not: null } },
      _count: true,
      orderBy: [{ _count: { categoryId: "desc" } }, { categoryId: "asc" }],
      take: 20,
    }),

    // Unclaimed listings that have received enquiries anyway. Somebody is
    // trying to reach them and they do not know.
    prisma.enquiryRecipient.groupBy({
      by: ["businessId"],
      where: { createdAt: { gte: since }, business: { claimStatus: "unclaimed" } },
      _count: true,
      orderBy: [{ _count: { businessId: "desc" } }, { businessId: "asc" }],
      take: SIGNAL_SCAN,
    }),

    prisma.callOutcome.findMany({
      where: { createdAt: { gte: calledSince } },
      orderBy: { createdAt: "desc" },
      select: { businessId: true, kind: true, createdAt: true },
    }),
  ]);

  const lastCall = new Map<string, { at: Date; kind: $Enums.CallOutcomeKind }>();
  for (const call of recentCalls) {
    if (!lastCall.has(call.businessId)) {
      lastCall.set(call.businessId, { at: call.createdAt, kind: call.kind });
    }
  }

  const ids = new Set<string>([
    ...missed.map((row) => row.businessId),
    ...unclaimed.map((row) => row.businessId),
  ]);

  // Businesses in a category buyers searched for and found nobody in.
  let thinTruncated = false;
  const thinCategoryIds = zeroResults
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);
  if (thinCategoryIds.length > 0) {
    const inThinCategories = await prisma.business.findMany({
      where: {
        primaryCategoryId: { in: thinCategoryIds },
        claimStatus: "claimed",
        planId: "free",
        suspendedAt: null,
        mergedIntoId: null,
      },
      select: { id: true },
      take: SIGNAL_SCAN,
    });
    thinTruncated = inThinCategories.length === SIGNAL_SCAN;
    for (const business of inThinCategories) ids.add(business.id);
  }

  if (ids.size === 0) return { prospects: [], total: 0, truncated: false };

  const businesses = await prisma.business.findMany({
    where: { id: { in: [...ids] }, suspendedAt: null, mergedIntoId: null },
    select: {
      id: true,
      displayName: true,
      slug: true,
      claimStatus: true,
      planId: true,
      primaryCategoryId: true,
    },
  });
  const byId = new Map(businesses.map((business) => [business.id, business]));

  const missedBy = new Map(missed.map((row) => [row.businessId, row._count]));
  const unclaimedBy = new Map(unclaimed.map((row) => [row.businessId, row._count]));
  const zeroBy = new Map(
    zeroResults
      .filter((row) => row.categoryId !== null)
      .map((row) => [row.categoryId!, row._count]),
  );

  const prospects: Prospect[] = [];

  for (const business of businesses) {
    const missedCount = missedBy.get(business.id) ?? 0;
    const unclaimedCount = unclaimedBy.get(business.id) ?? 0;
    const zeroCount = business.primaryCategoryId
      ? (zeroBy.get(business.primaryCategoryId) ?? 0)
      : 0;

    /*
     * One signal per prospect, the strongest. A call opens with one number, and
     * a list that offers three reasons for the same person is a list somebody
     * reads instead of dialling.
     */
    let signal: SignalKey;
    let value: number;
    let detail: string;

    if (missedCount > 0) {
      signal = "missed_at_cap";
      value = missedCount;
      detail = "enquiries their plan capped them out of";
    } else if (unclaimedCount > 0) {
      signal = "unclaimed_with_demand";
      value = unclaimedCount;
      detail = "enquiries sent to a listing nobody has claimed";
    } else if (zeroCount > 0) {
      signal = "zero_result_in_their_trade";
      value = zeroCount;
      detail = "searches in their trade that found nobody";
    } else {
      continue;
    }

    const last = lastCall.get(business.id);
    prospects.push({
      businessId: business.id,
      displayName: business.displayName,
      slug: business.slug,
      claimStatus: business.claimStatus,
      planId: business.planId,
      signal,
      value,
      detail,
      lastCalledAt: last?.at ?? null,
      lastOutcome: last?.kind ?? null,
    });
  }

  void byId;

  /*
   * Anybody called in the last week drops off. A prospect list that offers the
   * same person every morning is a list that gets somebody rung twice, and the
   * second call is worse than no call.
   */
  const ranked = prospects
    .filter((prospect) => prospect.lastCalledAt === null)
    .sort((a, b) => b.value - a.value);

  return {
    prospects: ranked.slice(0, limit),
    total: ranked.length,
    truncated:
      missed.length === SIGNAL_SCAN || unclaimed.length === SIGNAL_SCAN || thinTruncated,
  };
}

export type LogResult = { ok: true } | { ok: false; error: string };

export interface LogCallInput {
  actor: Actor;
  businessId: string;
  kind: $Enums.CallOutcomeKind;
  signal: string;
  note?: string;
  callBackAt?: Date;
}

/**
 * Log what happened, and let it move the account.
 *
 * Not audited. A call is not a staff mutation of platform state — nothing about
 * the listing, the plan or the tier changes — and putting "rang somebody" in
 * the same log as "decided who owns a listing" makes that log harder to read.
 * `CallOutcome` is its own record and is visible on the account.
 *
 * A call-back carries its date, enforced by a CHECK: a call-back with no date
 * is a note somebody will not act on.
 */
export async function logCall(input: LogCallInput): Promise<LogResult> {
  if (input.kind === "call_back" && !input.callBackAt) {
    return { ok: false, error: "A call-back needs a date, or it is a note nobody acts on." };
  }
  if (input.kind !== "call_back" && input.callBackAt) {
    return { ok: false, error: "Only a call-back carries a date." };
  }

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true },
  });
  if (!business) return { ok: false, error: "That business is not in the directory." };

  await prisma.callOutcome.create({
    data: {
      businessId: business.id,
      staffId: input.actor.id,
      kind: input.kind,
      signal: input.signal,
      note: input.note?.trim() || null,
      callBackAt: input.callBackAt ?? null,
    },
  });

  return { ok: true };
}

/** What has been said to this account, for the health screen. */
export async function callHistory(businessId: string, limit = 20) {
  return prisma.callOutcome.findMany({
    where: { businessId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      kind: true,
      signal: true,
      note: true,
      callBackAt: true,
      createdAt: true,
      staff: { select: { id: true, fullName: true } },
    },
  });
}
