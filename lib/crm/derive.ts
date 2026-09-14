import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { areaMatrix } from "@/lib/content/matrix";
import { stateWhere } from "@/lib/accounts/health-where";
import { CAP_REFUSED_EVENTS, UPGRADE_WINDOW_DAYS } from "@/lib/accounts/health";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  SIGNAL_WINDOW_DAYS,
  demandScoreOf,
  signalValueOf,
  strongerSignal,
  type CrmSignalKey,
  type SignalFacts,
} from "./model";

/**
 * Board 12d — every reason a business is worth a call, derived from what the
 * platform already measures.
 *
 * Five producers, one per signal, and each reads a writer that shipped with an
 * earlier board: 6f's area matrix for held pages, `ZeroResultQuery` from the
 * search step, `EnquiryRecipient` from the fan-out, `MissedEnquiry` and the
 * cap-refusal events 4f added, and 4f's churn-risk `where`. Nothing here is
 * typed by a person, and nothing here writes: `./sync.ts` turns the result into
 * tasks.
 *
 * One signal per business — `strongerSignal` decides — because a call opens
 * with one number.
 */

const DAY_MS = 86_400_000;
if (SIGNAL_WINDOW_DAYS !== UPGRADE_WINDOW_DAYS) {
  // The two windows are one decision; a cap refusal must be recent on 4f and here at once.
  throw new Error("SIGNAL_WINDOW_DAYS and board 4f's UPGRADE_WINDOW_DAYS have drifted apart.");
}
/** Deep enough that the platform's scale never truncates a signal. */
const SIGNAL_SCAN = 2000;

export interface DerivedSignal {
  businessId: string;
  signal: CrmSignalKey;
  signalRef: string;
  signalValue: number;
  demandScore: number;
  facts: SignalFacts;
}

const ALIVE = { suspendedAt: null, mergedIntoId: null, closedAt: null, closureRequestedAt: null } as const;

export async function deriveSignals(now: Date = new Date()): Promise<DerivedSignal[]> {
  const since = new Date(now.getTime() - SIGNAL_WINDOW_DAYS * DAY_MS);
  const week = new Date(now.getTime() - 7 * DAY_MS);

  const found = await Promise.all([churnRisk(now), capReached(since), unclaimedDemand(since), heldPages(now, week), zeroResult(since, week)]);

  const strongest = new Map<string, DerivedSignal>();
  for (const list of found) {
    for (const candidate of list) {
      const current = strongest.get(candidate.businessId);
      if (!current || (candidate.signal !== current.signal && strongerSignal(candidate.signal, current.signal) === candidate.signal)) {
        strongest.set(candidate.businessId, candidate);
      }
    }
  }
  return [...strongest.values()];
}

function derived(businessId: string, signal: CrmSignalKey, signalRef: string, facts: SignalFacts): DerivedSignal {
  return { businessId, signal, signalRef, facts, signalValue: signalValueOf(facts), demandScore: demandScoreOf(facts) };
}

// ── churn_risk ───────────────────────────────────────────────────────────────

/**
 * Board 4f's churn risk, with the renewal still ahead (B6).
 *
 * The population is 4f's `stateWhere("churn_risk")` — the same threshold, the
 * same paying definition — so the Renewal risk tab cannot disagree with 4f's
 * panel except by the accounts whose renewal has already passed, and the tab
 * says how many those are. The renewal date is the ref: when it passes, the ref
 * no longer derives and the task closes, because a save call after the renewal
 * is not a save.
 */
async function churnRisk(now: Date): Promise<DerivedSignal[]> {
  const rows = await prisma.business.findMany({
    where: { AND: [stateWhere("churn_risk", now), { subscription: { is: { renewsAt: { gt: now } } } }] },
    select: {
      id: true,
      replyRate: true,
      replySample: true,
      planId: true,
      subscription: { select: { renewsAt: true } },
    },
    orderBy: [{ id: "asc" }],
    take: SIGNAL_SCAN,
  });
  return rows
    .filter((row) => row.replyRate !== null && row.replySample !== null && row.subscription)
    .map((row) =>
      derived(row.id, "churn_risk", `renews:${row.subscription!.renewsAt.toISOString().slice(0, 10)}`, {
        kind: "churn_risk",
        replyRate: row.replyRate!,
        replySample: row.replySample!,
        renewsAt: row.subscription!.renewsAt.toISOString(),
        planId: row.planId ?? "",
      }),
    );
}

// ── cap_reached ──────────────────────────────────────────────────────────────

/**
 * An account on Free or Basic that hit a ceiling in the window.
 *
 * Enquiries missed at the monthly cap are buyer demand, and they set the demand
 * score. A product or service cap refusal is the seller's own demand for more
 * room — the upgrade signal 4f dates — and scores nought, so it sorts beneath
 * every call that has a buyer behind it.
 */
async function capReached(since: Date): Promise<DerivedSignal[]> {
  const [missed, refusals] = await Promise.all([
    prisma.missedEnquiry.groupBy({
      by: ["businessId"],
      where: { createdAt: { gte: since }, reason: "at_monthly_cap" },
      _count: { _all: true },
      orderBy: [{ businessId: "asc" }],
      take: SIGNAL_SCAN,
    }),
    prisma.productEvent.findMany({
      // The same thirty days 4f's upgrade candidacy reads.
      where: { name: { in: [...CAP_REFUSED_EVENTS] }, createdAt: { gte: since }, businessId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { businessId: true, name: true, props: true, createdAt: true },
      take: SIGNAL_SCAN,
    }),
  ]);

  const missedBy = new Map(missed.map((row) => [row.businessId, row._count._all]));
  const refusalBy = new Map<string, (typeof refusals)[number]>();
  for (const refusal of refusals) if (refusal.businessId && !refusalBy.has(refusal.businessId)) refusalBy.set(refusal.businessId, refusal);

  const ids = [...new Set([...missedBy.keys(), ...refusalBy.keys()])];
  if (ids.length === 0) return [];

  const businesses = await prisma.business.findMany({
    where: { id: { in: ids }, claimStatus: "claimed", planId: { in: ["free", "basic"] }, ...ALIVE },
    select: { id: true, planId: true },
  });

  return businesses.map((business) => {
    const missedCount = missedBy.get(business.id) ?? 0;
    const refusal = refusalBy.get(business.id) ?? null;
    const props = (refusal?.props ?? {}) as { cap?: unknown; attempted?: unknown };
    const cap = missedCount > 0 ? "enquiry_cap" : refusal?.name === "service_cap_refused" ? "service_cap" : "product_cap";
    return derived(business.id, "cap_reached", `${cap}:${business.planId ?? "none"}`, {
      kind: "cap_reached",
      cap,
      missedEnquiries30d: missedCount,
      refusedAt: refusal?.createdAt.toISOString() ?? null,
      refusedAttempted: typeof props.attempted === "number" ? props.attempted : null,
      refusedCap: typeof props.cap === "number" ? props.cap : null,
      planId: business.planId,
    });
  });
}

// ── unclaimed_demand ─────────────────────────────────────────────────────────

/** Enquiries sent to a listing nobody has claimed. Somebody is writing to them and they do not know. */
async function unclaimedDemand(since: Date): Promise<DerivedSignal[]> {
  const rows = await prisma.enquiryRecipient.groupBy({
    by: ["businessId"],
    where: { createdAt: { gte: since }, business: { claimStatus: "unclaimed", ...ALIVE } },
    _count: { _all: true },
    orderBy: [{ businessId: "asc" }],
    take: SIGNAL_SCAN,
  });
  return rows.map((row) =>
    derived(row.businessId, "unclaimed_demand", "enquiries", { kind: "unclaimed_demand", enquiries30d: row._count._all }),
  );
}

// ── held_page ────────────────────────────────────────────────────────────────

/**
 * Unverified listings in an area page board 6f routes to recruitment.
 *
 * 6f's `recruit` status is the hand-off — `STATUS_OWNER.recruit` is `ops_crm` —
 * so this does not re-decide which pages are held on supply; it reads the
 * matrix and calls the listings a verification would move. A page held for
 * copy stays content ops' row (B4), and a page a person held is nobody's call.
 *
 * The number a held-page call opens with is per supplier and per trade: the
 * searches in the business's own category and emirate last week that found
 * nobody. Never the scope's monthly figure, which is area-wide and a keyword
 * estimate — the script would sound impressive and be false.
 */
async function heldPages(now: Date, week: Date): Promise<DerivedSignal[]> {
  const matrix = await areaMatrix({ perPage: 100_000 }, now);
  const recruiting = matrix.rows.filter((row) => row.status === "recruit");
  if (recruiting.length === 0) return [];

  const [categories, rules] = await Promise.all([
    prisma.category.findMany({ select: { id: true, parentId: true, name: true } }),
    prisma.category.findMany({
      where: { id: { in: [...new Set(recruiting.map((row) => row.categoryId))] } },
      select: { id: true, verifiedShareMin: true },
    }),
  ]);
  const shareOf = new Map(rules.map((row) => [row.id, row.verifiedShareMin]));
  const nameOf = new Map(categories.map((row) => [row.id, row.name]));
  const parentOf = new Map(categories.map((row) => [row.id, row.parentId]));
  const rootOf = (id: string): string => {
    let current = id;
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = parentOf.get(current);
      if (!parent) return current;
      current = parent;
    }
    return current;
  };

  const areaIds = [...new Set(recruiting.map((row) => row.areaId))];
  const candidates = await prisma.$queryRaw<{ business_id: string; area_id: string; category_id: string; emirate: string; claimed: boolean }[]>`
    SELECT DISTINCT ON (b.id, l.area_id) b.id AS business_id, l.area_id, b.primary_category_id AS category_id, l.emirate::text AS emirate,
           (b.claim_status = 'claimed') AS claimed
      FROM business b
      JOIN location l ON l.business_id = b.id AND l.published = true
     WHERE l.area_id IN (${Prisma.join(areaIds)})
       AND b.published_at IS NOT NULL
       AND b.verification_tier < ${VERIFIED_TIER}
       AND b.suspended_at IS NULL
       AND b.merged_into_id IS NULL
       AND b.closed_at IS NULL
       AND b.closure_requested_at IS NULL
     ORDER BY b.id, l.area_id, l.id
  `;

  const searches = await prisma.zeroResultQuery.groupBy({
    by: ["categoryId", "emirate"],
    where: { createdAt: { gte: week }, categoryId: { not: null } },
    _count: { _all: true },
    orderBy: [{ categoryId: "asc" }, { emirate: "asc" }],
  });
  const searchesFor = new Map(searches.map((row) => [`${row.categoryId}:${row.emirate ?? ""}`, row._count._all]));

  const scopes = new Map(recruiting.map((row) => [`${row.areaId}:${row.categoryId}`, row]));
  const out: DerivedSignal[] = [];
  for (const candidate of candidates) {
    const scope = scopes.get(`${candidate.area_id}:${candidate.category_id}`) ?? scopes.get(`${candidate.area_id}:${rootOf(candidate.category_id)}`);
    if (!scope) continue;
    out.push(
      derived(candidate.business_id, "held_page", `${scope.areaId}:${scope.categoryId}`, {
        kind: "held_page",
        areaId: scope.areaId,
        areaName: scope.areaName,
        categoryId: scope.categoryId,
        categoryName: scope.categoryName,
        path: scope.path,
        listings: scope.listings,
        verified: scope.verified,
        need: scope.need,
        minVerifiedShare: shareOf.get(scope.categoryId) ?? 0.3,
        introWords: scope.introWords,
        minIntroWords: scope.minIntroWords,
        unverified: scope.listings - scope.verified,
        monthlySearches: scope.monthlySearches,
        failing: scope.failing,
        tradeSearchesWeek:
          (searchesFor.get(`${candidate.category_id}:${candidate.emirate}`) ?? 0) +
          (searchesFor.get(`${candidate.category_id}:`) ?? 0),
        trade: nameOf.get(candidate.category_id) ?? scope.categoryName,
        claimed: candidate.claimed,
      }),
    );
  }
  return out;
}

// ── zero_result ──────────────────────────────────────────────────────────────

/**
 * Free sellers in a trade buyers searched for and found nobody in.
 *
 * The twenty categories with the most empty searches, as the call list has
 * read them since handoff 4. A Free seller there is invisible to exactly the
 * buyers failing to find them.
 */
async function zeroResult(since: Date, week: Date): Promise<DerivedSignal[]> {
  const [month, lastWeek, waiting] = await Promise.all([
    prisma.zeroResultQuery.groupBy({
      by: ["categoryId"],
      where: { createdAt: { gte: since }, categoryId: { not: null } },
      _count: { _all: true },
      orderBy: [{ _count: { categoryId: "desc" } }, { categoryId: "asc" }],
      take: 20,
    }),
    prisma.zeroResultQuery.groupBy({
      by: ["categoryId"],
      where: { createdAt: { gte: week }, categoryId: { not: null } },
      _count: { _all: true },
      orderBy: [{ categoryId: "asc" }],
    }),
    /*
       Board 10e `B6`: a saved search that found nothing is the same demand held
       as a standing order — a buyer who asked to be told when this exists. It
       stands until something is listed (`lastMatchAt`), so it is not windowed,
       and a trade with alerts waiting is in the list even in a month with no
       fresh empty searches.
    */
    prisma.savedSearch.groupBy({
      by: ["categoryId"],
      where: { zeroResult: true, lastMatchAt: null, categoryId: { not: null } },
      _count: { _all: true },
      orderBy: [{ categoryId: "asc" }],
    }),
  ]);
  const categoryIds = [
    ...new Set([...month, ...waiting].map((row) => row.categoryId).filter((id): id is string => id !== null)),
  ];
  if (categoryIds.length === 0) return [];

  const [businesses, categories] = await Promise.all([
    prisma.business.findMany({
      where: { primaryCategoryId: { in: categoryIds }, claimStatus: "claimed", planId: "free", ...ALIVE },
      select: { id: true, primaryCategoryId: true },
      orderBy: [{ id: "asc" }],
      take: SIGNAL_SCAN,
    }),
    prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
  ]);
  const monthBy = new Map(month.map((row) => [row.categoryId!, row._count._all]));
  const weekBy = new Map(lastWeek.map((row) => [row.categoryId!, row._count._all]));
  const waitingBy = new Map(waiting.map((row) => [row.categoryId!, row._count._all]));
  const nameOf = new Map(categories.map((row) => [row.id, row.name]));

  return businesses.map((business) =>
    derived(business.id, "zero_result", business.primaryCategoryId, {
      kind: "zero_result",
      categoryId: business.primaryCategoryId,
      categoryName: nameOf.get(business.primaryCategoryId) ?? "",
      searches30d: monthBy.get(business.primaryCategoryId) ?? 0,
      searchesWeek: weekBy.get(business.primaryCategoryId) ?? 0,
      alertsWaiting: waitingBy.get(business.primaryCategoryId) ?? 0,
    }),
  );
}
