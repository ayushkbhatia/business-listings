import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { PAGE_SIZE, parseSearch, type AccountFilter } from "./filter";
import {
  CAP_REFUSED_EVENTS,
  PAYING_STATUSES,
  classifyAccount,
  upgradeWindowStart,
  type AccountState,
} from "./health";
import { PAYING_WHERE, stateWhere } from "./health-where";

/**
 * Board 4f — the accounts list, its counts, and the facts each row shows.
 *
 * **One `where` per view.** The page, its count, the export and a saved segment
 * all call `accountWhere` with the same filter; the chip and both panels call
 * `stateWhere` with the same state. `B4` is kept by there being nowhere else to
 * write a threshold, not by several queries remembering to agree.
 *
 * **Uncapped counts, paged rows.** 41,000 listings do not fit on a screen and
 * a page of fifty never pretends to be the total: the header counts are their
 * own queries, and the range line says which fifty.
 */

type Where = Prisma.BusinessWhereInput;

export function accountWhere(filter: AccountFilter, now: Date): Where {
  const and: Where[] = [];

  const terms = parseSearch(filter.q);
  if (terms) {
    const or: Where[] = [];
    if (terms.name) {
      // Trigram GIN indexes serve both of these as ILIKE '%…%'. The licence
      // name is searched and never shown: CLAUDE.md keeps `tradeName` to one
      // surface, and this is not it — but a caller reading off a licence says it.
      or.push({ displayName: { contains: terms.name, mode: "insensitive" } });
      or.push({ tradeName: { contains: terms.name, mode: "insensitive" } });
    }
    if (terms.licence) or.push({ licenceNumber: { equals: terms.licence, mode: "insensitive" } });
    if (terms.digits) {
      or.push({ licenceNumber: { endsWith: `-${terms.digits}` } });
      or.push({ licenceNumber: terms.digits });
    }
    if (terms.trn) or.push({ trn: terms.trn });
    // A query that could be none of the three matches nothing, honestly.
    and.push(or.length > 0 ? { OR: or } : { id: "__no_match__" });
  }

  if (filter.plan === "none") {
    // B2: unclaimed has no plan. Free is a plan somebody claimed their way onto.
    and.push({ OR: [{ claimStatus: { not: "claimed" } }, { planId: null }] });
  } else if (filter.plan) {
    and.push({ claimStatus: "claimed", planId: filter.plan });
  }

  if (filter.emirate) and.push({ locations: { some: { emirate: filter.emirate } } });
  if (filter.sector) and.push({ OR: [{ sectorId: filter.sector }, { primaryCategoryId: filter.sector }] });
  if (filter.tier !== undefined) and.push({ verificationTier: filter.tier });
  if (filter.kind) and.push({ sellsKind: filter.kind });
  if (filter.health) and.push(stateWhere(filter.health, now));

  return and.length === 0 ? {} : { AND: and };
}

// ── The header and the panels ───────────────────────────────────────────────

export interface AccountSummary {
  listings: number;
  claimed: number;
  /** B2: a paying status on a priced plan. Never "has a plan id". */
  paying: number;
  churnRisk: number;
  upgradeCandidates: number;
}

export async function accountSummary(now: Date): Promise<AccountSummary> {
  const [listings, claimed, paying, churnRisk, upgradeCandidates] = await Promise.all([
    prisma.business.count(),
    prisma.business.count({ where: { claimStatus: "claimed" } }),
    prisma.business.count({ where: PAYING_WHERE }),
    prisma.business.count({ where: stateWhere("churn_risk", now) }),
    prisma.business.count({ where: stateWhere("upgrade_candidate", now) }),
  ]);
  return { listings, claimed, paying, churnRisk, upgradeCandidates };
}

// ── One page ────────────────────────────────────────────────────────────────

const ROW_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  licenceNumber: true,
  claimStatus: true,
  planId: true,
  verificationTier: true,
  sellsKind: true,
  replyRate: true,
  replySample: true,
  responseTimeMedianMs: true,
  suspendedAt: true,
  mergedIntoId: true,
  closedAt: true,
  closureRequestedAt: true,
  subscription: { select: { status: true, plan: { select: { monthlyPriceAed: true } } } },
  locations: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1,
    select: { emirate: true, area: { select: { name: true } } },
  },
  claimSubmissions: {
    where: { outcome: "approved", decidedAt: { not: null } },
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    take: 1,
    select: { decidedAt: true },
  },
  _count: {
    select: {
      // What a plan cap counts: listed, not stored.
      products: { where: { status: "live" } },
      services: { where: { status: "live" } },
    },
  },
} satisfies Prisma.BusinessSelect;

type RawRow = Prisma.BusinessGetPayload<{ select: typeof ROW_SELECT }>;

export interface QuotedWindow {
  /** Sum of goods quote lines, latest revision per enquiry, as a decimal string. */
  goodsAed: string;
  quotes: number;
  proposals: number;
}

export interface UpgradeSignal {
  kind: "product_cap" | "service_cap" | "missed_at_cap";
  at: Date;
}

export interface AccountRow {
  id: string;
  slug: string;
  displayName: string;
  licenceNumber: string;
  areaName: string | null;
  emirate: string | null;
  claimedSince: Date | null;
  state: AccountState;
  /** Null while unclaimed — B2. */
  planId: string | null;
  paying: boolean;
  /** Null while unclaimed: an unclaimed listing has no rung a person earned. */
  tier: number | null;
  sellsKind: string;
  liveProducts: number;
  liveServices: number;
  replyRate: number | null;
  replySample: number | null;
  medianMs: number | null;
  quoted: QuotedWindow;
  /** The most recent ceiling in the window — the event an upgrade call refers to. */
  upgradeSignal: UpgradeSignal | null;
}

export interface AccountPage {
  rows: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const QUOTED_WINDOW_DAYS = 30;

export async function readAccountPage(filter: AccountFilter, page: number, now: Date): Promise<AccountPage> {
  const where = accountWhere(filter, now);
  const [total, raws] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({
      where,
      // Worst reply rate first, unmeasured last — the order an ops lead calls
      // down. Both branches written out, so `check:ordering` can read that each
      // ends on the id.
      orderBy:
        filter.sort === "reply_rate"
          ? [{ replyRate: { sort: "asc", nulls: "last" } }, { displayName: "asc" }, { id: "asc" }]
          : [{ displayName: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: ROW_SELECT,
    }),
  ]);
  const rows = await describeRows(raws, now);
  return { rows, total, page, pageSize: PAGE_SIZE };
}

/** Every row a filter matches, in batches, for the export. */
export async function* accountRows(filter: AccountFilter, now: Date, batch = 500): AsyncGenerator<AccountRow[]> {
  const where = accountWhere(filter, now);
  let cursor: string | null = null;
  for (;;) {
    const raws: RawRow[] = await prisma.business.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      orderBy: { id: "asc" },
      take: batch,
      select: ROW_SELECT,
    });
    if (raws.length === 0) return;
    yield await describeRows(raws, now);
    if (raws.length < batch) return;
    cursor = raws[raws.length - 1]!.id;
  }
}

export async function describeRows(raws: readonly RawRow[], now: Date): Promise<AccountRow[]> {
  const ids = raws.map((raw) => raw.id);
  if (ids.length === 0) return [];
  const [quoted, signals] = await Promise.all([quotedFor(ids, now), upgradeSignalsFor(ids, now)]);

  return raws.map((raw) => {
    const claimed = raw.claimStatus === "claimed";
    const paying =
      raw.subscription !== null &&
      (PAYING_STATUSES as readonly string[]).includes(raw.subscription.status) &&
      raw.subscription.plan.monthlyPriceAed > 0;
    const signal = signals.get(raw.id) ?? null;
    const location = raw.locations[0] ?? null;

    return {
      id: raw.id,
      slug: raw.slug,
      displayName: raw.displayName,
      licenceNumber: raw.licenceNumber,
      areaName: location?.area.name ?? null,
      emirate: location?.emirate ?? null,
      claimedSince: raw.claimSubmissions[0]?.decidedAt ?? null,
      state: classifyAccount({
        claimStatus: raw.claimStatus,
        suspendedAt: raw.suspendedAt,
        mergedIntoId: raw.mergedIntoId,
        closedAt: raw.closedAt,
        closureRequestedAt: raw.closureRequestedAt,
        planId: raw.planId,
        paying,
        replyRate: raw.replyRate,
        upgradeEventAt: signal?.at ?? null,
      }),
      planId: claimed ? raw.planId : null,
      paying,
      tier: claimed ? raw.verificationTier : null,
      sellsKind: raw.sellsKind,
      liveProducts: raw._count.products,
      liveServices: raw._count.services,
      replyRate: raw.replyRate,
      replySample: raw.replySample,
      medianMs: raw.responseTimeMedianMs,
      quoted: quoted.get(raw.id) ?? { goodsAed: "0", quotes: 0, proposals: 0 },
      upgradeSignal: signal,
    };
  });
}

/**
 * What each business sent buyers in the last thirty days.
 *
 * The latest non-draft revision per enquiry, so a quote revised three times is
 * counted once at its current value. Goods quotes sum their lines; a proposal
 * has no lines and a fee on a basis (per visit, per month), and adding a monthly
 * fee to a one-off total is arithmetic `1n-s` refuses — so proposals are
 * counted, not summed.
 */
async function quotedFor(ids: readonly string[], now: Date): Promise<Map<string, QuotedWindow>> {
  const since = new Date(now.getTime() - QUOTED_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.$queryRaw<
    { business_id: string; goods_aed: string | null; quotes: bigint; proposals: bigint }[]
  >`
    WITH latest AS (
      SELECT DISTINCT ON (q.enquiry_id, q.business_id) q.id, q.business_id
      FROM quote q
      WHERE q.business_id IN (${Prisma.join(ids)})
        AND q.status <> 'draft'
        AND q.sent_at >= ${since}
      ORDER BY q.enquiry_id, q.business_id, q.revision DESC, q.id DESC
    ),
    totals AS (
      SELECT l.id, l.business_id,
             (SELECT coalesce(sum(ql.unit_price * coalesce(ql.qty, 1)), 0) FROM quote_line ql WHERE ql.quote_id = l.id) AS goods,
             EXISTS (SELECT 1 FROM quote_proposal qp WHERE qp.quote_id = l.id) AS is_proposal
      FROM latest l
    )
    SELECT business_id,
           sum(goods) FILTER (WHERE NOT is_proposal)::text AS goods_aed,
           count(*) FILTER (WHERE NOT is_proposal) AS quotes,
           count(*) FILTER (WHERE is_proposal) AS proposals
    FROM totals
    GROUP BY business_id
  `;
  return new Map(
    rows.map((row) => [
      row.business_id,
      { goodsAed: row.goods_aed ?? "0", quotes: Number(row.quotes), proposals: Number(row.proposals) },
    ]),
  );
}

/**
 * The most recent ceiling each business hit inside the window. `B6`: a dated
 * event, so the call can open with it — "you tried to list 12 more products on
 * the 9th and could not".
 */
async function upgradeSignalsFor(ids: readonly string[], now: Date): Promise<Map<string, UpgradeSignal>> {
  const since = upgradeWindowStart(now);
  const [events, missed] = await Promise.all([
    prisma.productEvent.groupBy({
      by: ["businessId", "name"],
      where: { businessId: { in: [...ids] }, name: { in: [...CAP_REFUSED_EVENTS] }, createdAt: { gte: since } },
      _max: { createdAt: true },
    }),
    prisma.missedEnquiry.groupBy({
      by: ["businessId"],
      where: { businessId: { in: [...ids] }, createdAt: { gte: since } },
      _max: { createdAt: true },
    }),
  ]);

  const latest = new Map<string, UpgradeSignal>();
  const offer = (businessId: string | null, signal: UpgradeSignal) => {
    if (!businessId) return;
    const current = latest.get(businessId);
    if (!current || current.at.getTime() < signal.at.getTime()) latest.set(businessId, signal);
  };
  for (const row of events) {
    if (!row._max.createdAt) continue;
    offer(row.businessId, {
      kind: row.name === "service_cap_refused" ? "service_cap" : "product_cap",
      at: row._max.createdAt,
    });
  }
  for (const row of missed) {
    if (row._max.createdAt) offer(row.businessId, { kind: "missed_at_cap", at: row._max.createdAt });
  }
  return latest;
}
