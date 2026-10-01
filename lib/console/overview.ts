import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { countAccounts } from "@/lib/accounts/list";
import { claimConversion, claimsApprovedByWindow } from "@/lib/accounts/claims";
import { PAYING_WHERE } from "@/lib/accounts/health-where";
import { compositionOf, ledgerCountsByMonth, payingAt, periodFigures } from "@/lib/billing/revenue-board";
import { reconcile } from "@/lib/billing/revenue";
import { currentPeriod, periodFor, previousPeriod, type RevenuePeriod } from "@/lib/billing/revenue-period";
import { dunningSummary } from "@/lib/billing/dunning-queue";
import { outstandingInvoices } from "@/lib/billing/invoice-list";
import { openCallCount } from "@/lib/crm/board";
import { readHomeStats } from "@/lib/db/queries/home";
import { enquiriesByWindow } from "@/lib/enquiry/volume";
import { queuedRecordCount } from "@/lib/ingest/queue";
import { runsAwaitingReview } from "@/lib/ingest/read";
import { readMaintenanceWindow } from "@/lib/maintenance/source";
import { phaseAt } from "@/lib/maintenance/window";
import { loadQueue, queueHealth } from "@/lib/moderation/queue";
import { quotedValueByWindow } from "@/lib/quote/quoted-value";
import { loadReportQueue } from "@/lib/reports/queue";
import { REPORT_TYPES } from "@/lib/reports/taxonomy";
import { noGoodResultQueries } from "@/lib/search/no-good-result";
import { liveProductsWithoutSpecs } from "@/lib/spec/library";
import {
  loadTaxonomyTree,
  publishedBetween,
  rfqCount,
  rfqWindow,
  sectorStocks,
  subtreeIds,
} from "@/lib/taxonomy/board";
import {
  assembleOverview,
  type OverviewWarning,
  type OtherQueue,
  type OverviewLive,
  type OverviewPeriod,
  type OverviewSnapshot,
  type OverviewStatus,
  type OverviewView,
  ownerWarnings,
  type PlanAccounts,
} from "./overview-view";
import { mayOpen } from "./visibility";

/**
 * Board 4a — the platform overview, read.
 *
 * The flow map's one sentence is the brief: *six jobs keep the marketplace
 * working; this screen answers one question each morning — which of them is
 * behind — and every number on it links into the queue that fixes it.*
 *
 * **It owns almost none of its data** (B3). Every figure is another board's,
 * read through that board's own function — `4b`'s queue, `4h`'s reports, `4g`'s
 * ledger, `4f`'s accounts, `4d`'s tree, `12d`'s call list — and where a figure
 * had no callable owner one was built in the owner's module first. A second
 * implementation of a figure here is how this screen would drift from the board
 * it links to.
 *
 * Two blocks, because two kinds of figure sit on the screen (B4):
 *
 *   - **The snapshot** is one month: what the period picker drives. Computed
 *     once per month and cached, ten minutes for the month in progress and six
 *     hours for a closed one, under one tag a refresh clears.
 *   - **The live block** is now: the queues, the status chip, the stocks and
 *     the checks between boards. Never cached by period, so changing the month
 *     cannot move a live figure.
 *
 * `./overview-view.ts` assembles the two, filtered to what the seat may open.
 */


/** The tag every snapshot carries. *Refresh figures* clears it. */
export const OVERVIEW_CACHE_TAG = "admin-overview";

/** The month in progress is cached briefly; a closed month changes only when the ledger is corrected. */
const LIVE_MONTH_TTL_S = 10 * 60;
const CLOSED_MONTH_TTL_S = 6 * 60 * 60;

/** How many months the chart draws, ending with the selected one. */
export const CHART_MONTHS = 12;

/** How many months the picker offers, the month in progress first. */
export const PICKER_MONTHS = 13;

/**
 * The month a request asked for.
 *
 * The month in progress when nothing is asked, because this is the screen an
 * ops lead opens each morning and its live tiles are about now; `4g` opens on
 * the last closed month because a revenue report is read whole. A link to `4g`
 * carries the month either way. A malformed or future month reads as the last
 * closed one, `4g`'s own rule.
 */
export function overviewPeriodFor(key: string | null | undefined, now: Date = new Date()): RevenuePeriod {
  return key ? periodFor(key, now) : currentPeriod(now);
}

function iso(period: RevenuePeriod): OverviewPeriod {
  return {
    key: period.key,
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    monthEnd: period.monthEnd.toISOString(),
    partial: period.partial,
    daysElapsed: period.daysElapsed,
    daysInMonth: period.daysInMonth,
  };
}

/** Twelve months ending with `period`, oldest first. */
export function chartPeriods(period: RevenuePeriod, now: Date): RevenuePeriod[] {
  const months = [period];
  while (months.length < CHART_MONTHS) months.unshift(previousPeriod(months[0]!, now));
  return months;
}

// ── The snapshot ─────────────────────────────────────────────────────────────

/**
 * One month's figures, uncached. The integration tests call this; the page
 * and the API call `loadSnapshot`, which caches it.
 */
export async function readSnapshot(periodKey: string, now: Date = new Date()): Promise<OverviewSnapshot> {
  const period = overviewPeriodFor(periodKey, now);
  const previous = previousPeriod(period, now);
  const months = chartPeriods(period, now);
  const windows = months.map((month) => ({ key: month.key, from: month.from, to: month.to }));
  const rfq = rfqWindow(period.to);

  const [figures, published, claims, quoted, ledgerCounts, enquiries, tree, noGoodResult, conversion] =
    await Promise.all([
      periodFigures(period),
      publishedBetween(period.from, period.to),
      claimsApprovedByWindow(windows),
      quotedValueByWindow([
        { key: period.key, from: period.from, to: period.to },
        { key: previous.key, from: previous.from, to: previous.to },
      ]),
      ledgerCountsByMonth(months),
      enquiriesByWindow(windows),
      loadTaxonomyTree(),
      noGoodResultQueries(period.from, period.to),
      claimConversion(period.to),
    ]);

  const [composition, sectorRfqs] = await Promise.all([
    compositionOf(figures.stateAtEnd),
    Promise.all(
      tree.sectors.map(async (sector) => [sector.id, await rfqCount(subtreeIds(sector), rfq.since, rfq.until)] as const),
    ),
  ]);

  return {
    period: iso(period),
    previous: iso(previous),
    computedAt: now.toISOString(),
    publishedInPeriod: published,
    claimsApproved: claims.get(period.key) ?? 0,
    paid: { atEnd: figures.month.payingAtEnd, atStart: figures.month.payingAtStart },
    mrr: { endingFils: figures.endingFils, startingFils: figures.month.startingFils, composition },
    quoted: { current: quoted.get(period.key)!, previous: quoted.get(previous.key)! },
    chart: months.map((month) => ({
      key: month.key,
      from: month.from.toISOString(),
      claims: claims.get(month.key) ?? 0,
      upgrades: ledgerCounts.get(month.key)?.upgrades ?? 0,
      churn: ledgerCounts.get(month.key)?.churn ?? 0,
      rfqs: enquiries.get(month.key) ?? 0,
      partial: month.partial,
    })),
    rfqWindow: { from: rfq.since.toISOString(), to: rfq.until.toISOString() },
    sectorRfqs: Object.fromEntries(sectorRfqs),
    noGoodResult,
    conversion: {
      cohort: conversion.cohort,
      converted: conversion.converted,
      rate: conversion.rate,
      claimedFrom: conversion.claimedFrom?.toISOString() ?? null,
      claimedTo: conversion.claimedTo?.toISOString() ?? null,
    },
  };
}

/**
 * The cached snapshot. `unstable_cache` needs a Next request context, so only
 * the page, the API and the refresh action call this.
 */
export function loadSnapshot(periodKey: string, partial: boolean): Promise<OverviewSnapshot> {
  return unstable_cache(() => readSnapshot(periodKey), ["admin-overview", periodKey], {
    revalidate: partial ? LIVE_MONTH_TTL_S : CLOSED_MONTH_TTL_S,
    tags: [OVERVIEW_CACHE_TAG],
  })();
}

// ── The live block ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The click log's window: which figure was opened most this month. */
export const OPENS_WINDOW_DAYS = 30;

async function statusNow(now: Date): Promise<OverviewStatus> {
  const window = await readMaintenanceWindow(now.getTime());
  if (!window) return { state: "normal" };
  const phase = phaseAt(window, now);
  const systems = window.affected.filter((row) => row.state === "down").map((row) => row.system);
  if (phase === "lapsed" || systems.length === 0) return { state: "normal" };
  if (phase === "upcoming") {
    return { state: "planned", startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString(), systems };
  }
  return {
    state: "down",
    since: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    systems,
    overrun: phase === "overrun",
  };
}

/** The figures opened most from the overview, over the window. Staff clicks only. */
export async function figureOpens(now: Date = new Date()): Promise<{ figure: string; count: number }[]> {
  const since = new Date(now.getTime() - OPENS_WINDOW_DAYS * DAY_MS);
  const rows = await prisma.$queryRaw<{ figure: string | null; count: bigint }[]>`
    SELECT props->>'figure' AS figure, COUNT(*) AS count
    FROM product_event
    WHERE name = 'overview_figure_opened' AND created_at >= ${since}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
    LIMIT 3
  `;
  return rows
    .filter((row): row is { figure: string; count: bigint } => typeof row.figure === "string")
    .map((row) => ({ figure: row.figure, count: Number(row.count) }));
}

/** The kept figures, only those whose screen this seat may open. */
async function otherQueues(actor: Actor, now: Date, may: (navKey: string) => boolean): Promise<OtherQueue[]> {
  const jobs: Promise<OtherQueue | null>[] = [
    may("ingest") ? runsAwaitingReview().then((runs) => ({ key: "import_runs" as const, count: runs.length })) : Promise.resolve(null),
    may("ingest") ? queuedRecordCount().then((count) => ({ key: "records_to_categorise" as const, count })) : Promise.resolve(null),
    may("spec-library")
      ? liveProductsWithoutSpecs().then((count) => ({ key: "products_without_specs" as const, count }))
      : Promise.resolve(null),
    may("crm") ? openCallCount(actor).then((count) => ({ key: "open_calls" as const, count })) : Promise.resolve(null),
    may("dunning") ? dunningSummary(now).then((summary) => ({ key: "past_due" as const, count: summary.inSequence })) : Promise.resolve(null),
    may("invoices")
      ? outstandingInvoices().then((owed) => ({ key: "invoices_outstanding" as const, count: owed.count, amountFils: owed.fils }))
      : Promise.resolve(null),
    may("businesses")
      ? countAccounts({ licence: "expiring" }, now).then((count) => ({ key: "licences_expiring" as const, count }))
      : Promise.resolve(null),
  ];
  return (await Promise.all(jobs)).filter((queue): queue is OtherQueue => queue !== null);
}

/**
 * What a paying account's plan is, by the ledger, among claimed businesses —
 * and the payers that are not claimed, which should be none.
 */
async function planMixNow(now: Date): Promise<{ plans: PlanAccounts[]; payers: number; unclaimedPayers: number }> {
  const payers = await payingAt(now);
  const [claimedPayers, plans] = await Promise.all([
    payers.length === 0
      ? Promise.resolve([] as { id: string }[])
      : prisma.business.findMany({
          where: { id: { in: payers.map((payer) => payer.businessId) }, claimStatus: "claimed" },
          select: { id: true },
        }),
    prisma.plan.findMany({
      select: { id: true, name: true, monthlyPriceAed: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);
  const claimed = new Set(claimedPayers.map((row) => row.id));
  const accounts = new Map<string, number>();
  for (const payer of payers) {
    if (!claimed.has(payer.businessId) || !payer.planId) continue;
    accounts.set(payer.planId, (accounts.get(payer.planId) ?? 0) + 1);
  }
  return {
    plans: plans
      .filter((plan) => accounts.has(plan.id))
      .map((plan) => ({
        planId: plan.id,
        planName: plan.name,
        listPriceFils: Math.round(plan.monthlyPriceAed * 100),
        accounts: accounts.get(plan.id)!,
      })),
    payers: payers.length,
    unclaimedPayers: payers.length - claimed.size,
  };
}

export async function readLive(actor: Actor, now: Date = new Date()): Promise<OverviewLive> {
  const may = (navKey: string) => mayOpen(actor, navKey);

  const tree = await loadTaxonomyTree();
  const [
    home,
    claimed,
    claimedLive,
    payingSubscriptions,
    paidPlanColumn,
    mix,
    sectors,
    queueView,
    health,
    reportView,
    status,
    others,
    ledger,
    opens,
  ] = await Promise.all([
    readHomeStats(),
    countAccounts({ claimed: true }, now),
    countAccounts({ status: "live", claimed: true }, now),
    prisma.business.count({ where: PAYING_WHERE }),
    // `4f`'s plan column: claimed businesses whose plan is a priced one.
    prisma.business.count({ where: { claimStatus: "claimed", plan: { is: { monthlyPriceAed: { gt: 0 } } } } }),
    planMixNow(now),
    sectorStocks(tree),
    may("queue") ? loadQueue({}, now) : Promise.resolve(null),
    may("queue") ? queueHealth(now) : Promise.resolve(null),
    may("reports") ? loadReportQueue({}, now) : Promise.resolve(null),
    statusNow(now),
    otherQueues(actor, now, may),
    may("revenue") ? reconcile() : Promise.resolve(null),
    figureOpens(now),
  ]);

  /*
     Where two owners state one figure, both are read and any difference is
     said on the tile — Phase 5's reconciliation, run live as well as nightly:
     a warning a day late is a morning of a wrong number.
  */
  const warnings = ownerWarnings({
    treeListings: tree.totals.listings,
    homeListings: home.listings,
    ledgerPayers: mix.payers,
    subscriptionPayers: payingSubscriptions,
    claimedLedgerPayers: mix.plans.reduce((sum, plan) => sum + plan.accounts, 0),
    planColumnPayers: paidPlanColumn,
    mrr: ledger,
  });

  return {
    now: now.toISOString(),
    listingsLive: tree.totals.listings,
    claimed,
    claimedLive,
    planMix: mix.plans,
    sectors: sectors.map((sector) => ({ id: sector.id, name: sector.name, listings: sector.listings, claimed: sector.claimed })),
    queue: queueView
      ? {
          open: queueView.total,
          overSla: queueView.overSla,
          conflicts: queueView.counts.conflict,
          lastDecidedAt: health?.lastDecidedAt?.toISOString() ?? null,
        }
      : null,
    reports: reportView
      ? {
          open: reportView.total,
          overSla: reportView.overSla,
          types: REPORT_TYPES.map((type) => ({ type, count: reportView.counts[type] })),
        }
      : null,
    status,
    otherQueues: others,
    warnings,
    opens,
  };
}

// ── The nightly reconciliation ───────────────────────────────────────────────

/** The comparisons `ownerWarnings` makes: listings, payers twice, unclaimed payers, MRR. */
const RECONCILED_PAIRS = 5;

/**
 * Phase 5's reconciliation suite, as a daily job step: the same comparisons the
 * overview makes live, run with every owner's figure and kept on the job's run
 * record, so a disagreement has a date as well as a warning. A disagreement is
 * a finding about the data, not a failed step — the step returns it rather than
 * throwing, and the overview's tiles say it every time they are opened.
 */
export async function reconcileOverview(now: Date = new Date()): Promise<{ checked: number; disagreements: OverviewWarning[] }> {
  const [tree, home, payingSubscriptions, paidPlanColumn, mix, ledger] = await Promise.all([
    loadTaxonomyTree(),
    readHomeStats(),
    prisma.business.count({ where: PAYING_WHERE }),
    prisma.business.count({ where: { claimStatus: "claimed", plan: { is: { monthlyPriceAed: { gt: 0 } } } } }),
    planMixNow(now),
    reconcile(),
  ]);
  const disagreements = ownerWarnings({
    treeListings: tree.totals.listings,
    homeListings: home.listings,
    ledgerPayers: mix.payers,
    subscriptionPayers: payingSubscriptions,
    claimedLedgerPayers: mix.plans.reduce((sum, plan) => sum + plan.accounts, 0),
    planColumnPayers: paidPlanColumn,
    mrr: ledger,
  });
  return { checked: RECONCILED_PAIRS, disagreements };
}

// ── The overview ─────────────────────────────────────────────────────────────

export interface PlatformOverview {
  view: OverviewView;
  /** The picker's months, newest first. */
  periods: RevenuePeriod[];
}

/** What `/admin` renders and `GET /api/admin/overview` returns. */
export async function platformOverview(
  actor: Actor,
  periodKey: string | null | undefined,
  now: Date = new Date(),
  options: { cached?: boolean } = {},
): Promise<PlatformOverview> {
  const period = overviewPeriodFor(periodKey ?? null, now);
  const [snapshot, live] = await Promise.all([
    options.cached === false ? readSnapshot(period.key, now) : loadSnapshot(period.key, period.partial),
    readLive(actor, now),
  ]);
  const periods: RevenuePeriod[] = [];
  let cursor = currentPeriod(now);
  while (periods.length < PICKER_MONTHS) {
    periods.push(cursor);
    cursor = previousPeriod(cursor, now);
  }
  return { view: assembleOverview(snapshot, live, (navKey) => mayOpen(actor, navKey)), periods };
}
