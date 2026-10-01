import type { MrrComposition } from "@/lib/billing/mrr-composition";
import type { SystemKey } from "@/lib/maintenance/systems";
import type { ReportType } from "@/lib/reports/taxonomy";
import {
  bySupplyGap,
  chartGeometry,
  shareOf,
  supplyGapLabel,
  supplyGapRatio,
  type ChartGeometry,
  type ChartMonth,
  type SupplyGapLabel,
} from "./overview-model";

/**
 * Board 4a — the overview, assembled.
 *
 * `./overview.ts` reads two blocks and hands them here:
 *
 *   - **The snapshot**, the figures for one month. Computed once per period
 *     and cached, so it is JSON-safe: every date is an ISO string.
 *   - **The live block**, the figures for now. Never cached by period (B4):
 *     the queue, the reports, the status chip, the stocks and every
 *     reconciliation check.
 *
 * This module turns them into one view: each figure with its value, the link
 * into the board that owns it (B1) and the nav key whose capability decides who
 * may follow that link. It is what `GET /api/admin/overview` returns and what
 * the page formats, so the API and the screen cannot disagree about a figure or
 * where it goes. Pure, and unit-tested.
 */

// ── The two blocks ───────────────────────────────────────────────────────────

export interface OverviewPeriod {
  /** `2026-09`. */
  key: string;
  /** Midnight in Dubai on the first, ISO. */
  from: string;
  /** Where the figures stop: the month's end, or now for the month in progress. */
  to: string;
  monthEnd: string;
  partial: boolean;
  daysElapsed: number;
  daysInMonth: number;
}

export interface QuotedValueFigure {
  fils: number;
  quotes: number;
  proposals: number;
}

export interface NoGoodResultRow {
  query: string;
  normalised: string;
  searches: number;
  suppliersToday: number;
}

export interface OverviewSnapshot {
  period: OverviewPeriod;
  previous: OverviewPeriod;
  /** When the snapshot was computed, ISO. The header says it when it is not fresh. */
  computedAt: string;
  /** Listings whose publication falls in the month. */
  publishedInPeriod: number;
  /** Claims approved in the month. */
  claimsApproved: number;
  /** `4g`'s paying accounts at the month's two ends. */
  paid: { atEnd: number; atStart: number };
  /** `4g`'s MRR at the month's two ends, and what the end is made of. */
  mrr: { endingFils: number; startingFils: number; composition: MrrComposition };
  quoted: { current: QuotedValueFigure; previous: QuotedValueFigure };
  /** Twelve months ending with this one, oldest first. */
  chart: ChartMonth[];
  /** The thirty days the category table's RFQs cover. */
  rfqWindow: { from: string; to: string };
  /** RFQs per sector over `rfqWindow`, by sector id. */
  sectorRfqs: Record<string, number>;
  noGoodResult: { rows: NoGoodResultRow[]; checked: number };
  conversion: {
    cohort: number;
    converted: number;
    rate: number | null;
    claimedFrom: string | null;
    claimedTo: string | null;
  };
}

export type OverviewStatus =
  | { state: "normal" }
  | { state: "planned"; startsAt: string; endsAt: string; systems: SystemKey[] }
  | { state: "down"; since: string; endsAt: string; systems: SystemKey[]; overrun: boolean };

export interface PlanAccounts {
  planId: string;
  planName: string;
  /** Today's monthly list price, in fils. */
  listPriceFils: number;
  accounts: number;
}

export interface SectorStock {
  id: string;
  name: string;
  listings: number;
  claimed: number;
}

/**
 * A figure kept from the console's five-job panels, in the card the owner kept
 * them in on 1 Oct 2026 (*Other queues*). Each opens the screen that fixes it,
 * filtered to the same rows.
 */
export type OtherQueueKey =
  | "import_runs"
  | "records_to_categorise"
  | "products_without_specs"
  | "open_calls"
  | "past_due"
  | "invoices_outstanding"
  | "licences_expiring";

export interface OtherQueue {
  key: OtherQueueKey;
  count: number;
  /** For invoices: the amount owed on them, in fils. */
  amountFils?: number;
}

export type WarningKind = "listings_home" | "paying_ledger" | "mrr_ledger" | "plan_column" | "unclaimed_payers";

/**
 * Two owners disagreeing about one figure. The overview reads both and says so
 * on the tile that carries it, rather than picking one quietly — this screen is
 * where the boards' disagreements show up.
 */
export interface OverviewWarning {
  kind: WarningKind;
  tile: "listings" | "paid" | "mrr";
  /** What each side said. */
  ours: number;
  theirs: number;
}

export interface OverviewLive {
  /** ISO. */
  now: string;
  /** Live on the directory: `4d`'s tree total, `1a`'s hero. */
  listingsLive: number;
  /** Claimed, in any state of publication: `4f`'s figure. */
  claimed: number;
  /** Claimed and live: the share's numerator. */
  claimedLive: number;
  /** Paying now, by the ledger, per plan — claimed businesses only. Free is the rest of `claimed`. */
  planMix: PlanAccounts[];
  /** Live stocks per sector. RFQs come from the snapshot. */
  sectors: SectorStock[];
  /** Null when the seat cannot open the queue. */
  queue: { open: number; overSla: number; conflicts: number; lastDecidedAt: string | null } | null;
  /** Null when the seat cannot open the reports queue. */
  reports: { open: number; overSla: number; types: { type: ReportType; count: number }[] } | null;
  status: OverviewStatus;
  /** Only those the seat may open. */
  otherQueues: OtherQueue[];
  warnings: OverviewWarning[];
  /** The most-opened figures over the last thirty days, from the click log. */
  opens: { figure: string; count: number }[];
}

// ── Where two owners state one figure ────────────────────────────────────────

/** What each owner said, gathered by `./overview.ts`. */
export interface OwnerFacts {
  /** `4d`'s tree total. */
  treeListings: number;
  /** `1a`'s hero count. */
  homeListings: number;
  /** `4g`'s ledger: accounts paying now. */
  ledgerPayers: number;
  /** `4f`'s subscription table: accounts paying now. */
  subscriptionPayers: number;
  /** Of the ledger's payers, the claimed businesses. */
  claimedLedgerPayers: number;
  /** `4f`'s plan column: claimed businesses on a priced plan. */
  planColumnPayers: number;
  /** `4g`'s reconciliation of the ledger against subscriptions, or null where the seat cannot see revenue. */
  mrr: { agrees: boolean; ledgerFils: number; liveFils: number } | null;
}

/**
 * Phase 5's reconciliation: every figure here must equal the same figure on
 * its owning board, and where two boards own one figure the overview shows a
 * warning on that tile rather than choosing between them. The nightly job runs
 * the same comparison and keeps the result (`reconcileOverview`).
 */
export function ownerWarnings(facts: OwnerFacts): OverviewWarning[] {
  const warnings: OverviewWarning[] = [];
  if (facts.treeListings !== facts.homeListings) {
    warnings.push({ kind: "listings_home", tile: "listings", ours: facts.treeListings, theirs: facts.homeListings });
  }
  if (facts.ledgerPayers !== facts.subscriptionPayers) {
    warnings.push({ kind: "paying_ledger", tile: "paid", ours: facts.ledgerPayers, theirs: facts.subscriptionPayers });
  }
  if (facts.claimedLedgerPayers !== facts.planColumnPayers) {
    warnings.push({ kind: "plan_column", tile: "paid", ours: facts.claimedLedgerPayers, theirs: facts.planColumnPayers });
  }
  const unclaimed = facts.ledgerPayers - facts.claimedLedgerPayers;
  if (unclaimed > 0) warnings.push({ kind: "unclaimed_payers", tile: "paid", ours: unclaimed, theirs: 0 });
  if (facts.mrr && !facts.mrr.agrees) {
    warnings.push({ kind: "mrr_ledger", tile: "mrr", ours: facts.mrr.ledgerFils, theirs: facts.mrr.liveFils });
  }
  return warnings;
}

// ── Deep links (B1) ──────────────────────────────────────────────────────────

/**
 * Where every figure goes, and the nav key whose capability gates it.
 *
 * Each link carries the filter that reproduces its figure on the owning board,
 * so the number clicked is the number the destination states. Five of these
 * filters did not exist before this board needed them — `4f`'s `status`,
 * `claimed`, `paying` and `licence`, `4b`'s `overdue`, `4h`'s `late` and
 * `12d`'s `category` — and `/admin/quotes` did not exist at all.
 */
export interface FigureLink {
  href: string;
  navKey: string;
}

export const LINKS = {
  listings: { href: "/admin/businesses?status=live", navKey: "businesses" },
  claimed: { href: "/admin/businesses?claimed=1", navKey: "businesses" },
  paid: { href: "/admin/businesses?paying=1", navKey: "businesses" },
  queue: { href: "/admin/queue", navKey: "queue" },
  queueOverdue: { href: "/admin/queue?overdue=1", navKey: "queue" },
  conflicts: { href: "/admin/queue?kind=conflict", navKey: "queue" },
  reportsLate: { href: "/admin/reports?late=1", navKey: "reports" },
  planFree: { href: "/admin/businesses?claimed=1&paying=0", navKey: "businesses" },
  status: { href: "/maintenance", navKey: "admin" },
  importRuns: { href: "/admin/ingest", navKey: "ingest" },
  recordsToCategorise: { href: "/admin/ingest/categorise", navKey: "ingest" },
  productsWithoutSpecs: { href: "/admin/spec-library", navKey: "spec-library" },
  openCalls: { href: "/admin/crm", navKey: "crm" },
  pastDue: { href: "/admin/dunning", navKey: "dunning" },
  invoicesOutstanding: { href: "/admin/invoices", navKey: "invoices" },
  licencesExpiring: { href: "/admin/businesses?licence=expiring", navKey: "businesses" },
} as const satisfies Record<string, FigureLink>;

export function mrrLink(periodKey: string): FigureLink {
  return { href: `/admin/revenue?period=${periodKey}`, navKey: "revenue" };
}

export function quotedLink(periodKey: string): FigureLink {
  return { href: `/admin/quotes?period=${periodKey}`, navKey: "admin" };
}

export function reportTypeLink(type: ReportType): FigureLink {
  return { href: `/admin/reports?type=${type}`, navKey: "reports" };
}

export function planLink(planId: string): FigureLink {
  return { href: `/admin/businesses?claimed=1&paying=1&plan=${planId}`, navKey: "businesses" };
}

export function sectorLinks(sectorId: string): {
  sector: FigureLink;
  listings: FigureLink;
  claimed: FigureLink;
  recruit: FigureLink;
} {
  return {
    sector: { href: `/admin/categories?c=${sectorId}`, navKey: "categories" },
    listings: { href: `/admin/businesses?status=live&sector=${sectorId}`, navKey: "businesses" },
    claimed: { href: `/admin/businesses?status=live&claimed=1&sector=${sectorId}`, navKey: "businesses" },
    recruit: { href: `/admin/crm?category=${sectorId}`, navKey: "crm" },
  };
}

export const OTHER_QUEUE_LINKS: Record<OtherQueueKey, FigureLink> = {
  import_runs: LINKS.importRuns,
  records_to_categorise: LINKS.recordsToCategorise,
  products_without_specs: LINKS.productsWithoutSpecs,
  open_calls: LINKS.openCalls,
  past_due: LINKS.pastDue,
  invoices_outstanding: LINKS.invoicesOutstanding,
  licences_expiring: LINKS.licencesExpiring,
};

// ── The assembled view ───────────────────────────────────────────────────────

/** A predicate the caller builds from the seat: may it open the screen behind a nav key? */
export type MayOpen = (navKey: string) => boolean;

export interface Linked {
  /** Null where the seat cannot open the destination: the figure renders unlinked, or not at all. */
  href: string | null;
}

export interface TileView extends Linked {
  key: "listings" | "claimed" | "paid" | "mrr" | "quoted" | "queue";
  /** `now` ignores the period picker; `period` follows it (B4). */
  scope: "now" | "period";
  /** A count, or fils for the two money tiles. */
  value: number;
  warnings: OverviewWarning[];
}

export interface CategoryRow {
  sectorId: string;
  name: string;
  listings: number;
  claimed: number;
  claimedShare: number | null;
  rfqs: number;
  ratio: number | null;
  label: SupplyGapLabel;
  links: { sector: string | null; listings: string | null; claimed: string | null; recruit: string | null };
}

export interface NeedsHumanRow extends Linked {
  key: string;
  count: number;
  /** For a 4h type, the type — the presenter names it with 4h's own label. */
  reportType?: ReportType;
  /** Red only where something is past its service level. */
  urgent: boolean;
}

export interface PlanMixRow extends Linked {
  key: string;
  planId: string | null;
  planName: string | null;
  /** Null for Free, which has no price to print. */
  listPriceFils: number | null;
  accounts: number;
  /** One scale (B5): a share of claimed on every row. */
  share: number | null;
}

export interface OverviewView {
  period: OverviewPeriod;
  previous: OverviewPeriod;
  snapshotAt: string;
  now: string;
  tiles: TileView[];
  /** Figures per tile, raw, for the presenter. */
  figures: {
    listings: { value: number; publishedInPeriod: number };
    claimed: { value: number; live: number; listingsLive: number; share: number | null; approvedInPeriod: number };
    paid: { atEnd: number; atStart: number; net: number };
    /** Absent for a seat without `revenue.read` (B10). */
    mrr?: { endingFils: number; startingFils: number; change: number | null; composition: MrrComposition };
    quoted: QuotedValueFigure & { previousFils: number; change: number | null };
    /** Absent for a seat that cannot open the queue. */
    queue?: { open: number; overSla: number; lastDecidedAt: string | null };
  };
  chart: { months: ChartMonth[]; geometry: ChartGeometry };
  categories: { rows: CategoryRow[]; sectors: number; rfqWindow: { from: string; to: string } };
  /** Absent when the seat can open neither queue. */
  needsHuman?: { rows: NeedsHumanRow[]; overdue: number };
  /** Absent for a seat without `revenue.read` (B10). */
  planMix?: { rows: PlanMixRow[]; claimed: number; conversion: OverviewSnapshot["conversion"] };
  noGoodResult: OverviewSnapshot["noGoodResult"];
  otherQueues: (OtherQueue & Linked)[];
  status: OverviewStatus & Linked;
  warnings: OverviewWarning[];
  opens: OverviewLive["opens"];
}

/** How many category rows the table shows before *Show all*. The render drew five. */
export const CATEGORY_ROWS_SHOWN = 5;

function linkFor(link: FigureLink, mayOpen: MayOpen): string | null {
  return mayOpen(link.navKey) ? link.href : null;
}

/** Signed change as a ratio of the earlier figure, or null with nothing to compare against. */
export function changeOf(current: number, previous: number): number | null {
  return previous > 0 ? current / previous - 1 : null;
}

export function assembleOverview(
  snapshot: OverviewSnapshot,
  live: OverviewLive,
  mayOpen: MayOpen,
): OverviewView {
  const revenue = mayOpen("revenue");
  /*
     The checks compare owners as they stand now. On a closed month the paid and
     MRR tiles state that month's end, which a disagreement today says nothing
     about, so the warning rides only on the month in progress. Listings live is
     a figure for now whichever month is picked.
  */
  const applies = (warning: OverviewWarning) =>
    (warning.tile !== "mrr" || revenue) && (warning.tile === "listings" || snapshot.period.partial);
  const warnings = live.warnings.filter(applies);
  const warningsFor = (tile: OverviewWarning["tile"]) => warnings.filter((warning) => warning.tile === tile);

  const tiles: TileView[] = [
    { key: "listings", scope: "now", value: live.listingsLive, href: linkFor(LINKS.listings, mayOpen), warnings: warningsFor("listings") },
    { key: "claimed", scope: "now", value: live.claimed, href: linkFor(LINKS.claimed, mayOpen), warnings: [] },
    { key: "paid", scope: "period", value: snapshot.paid.atEnd, href: linkFor(LINKS.paid, mayOpen), warnings: warningsFor("paid") },
  ];
  // B10: a finance figure is omitted for a seat that cannot see revenue, not shown blank.
  if (revenue) {
    tiles.push({
      key: "mrr",
      scope: "period",
      value: snapshot.mrr.endingFils,
      href: linkFor(mrrLink(snapshot.period.key), mayOpen),
      warnings: warningsFor("mrr"),
    });
  }
  tiles.push({
    key: "quoted",
    scope: "period",
    value: snapshot.quoted.current.fils,
    href: linkFor(quotedLink(snapshot.period.key), mayOpen),
    warnings: [],
  });
  if (live.queue) {
    tiles.push({ key: "queue", scope: "now", value: live.queue.open, href: linkFor(LINKS.queue, mayOpen), warnings: [] });
  }

  // ── Category health ──
  const stockBy = new Map(live.sectors.map((sector) => [sector.id, sector]));
  const rows: CategoryRow[] = live.sectors
    .map((sector) => {
      const rfqs = snapshot.sectorRfqs[sector.id] ?? 0;
      const ratio = supplyGapRatio(rfqs, sector.claimed);
      const label = supplyGapLabel(ratio);
      const links = sectorLinks(sector.id);
      return {
        sectorId: sector.id,
        name: sector.name,
        listings: sector.listings,
        claimed: sector.claimed,
        claimedShare: shareOf(sector.claimed, sector.listings),
        rfqs,
        ratio,
        label,
        links: {
          sector: linkFor(links.sector, mayOpen),
          listings: linkFor(links.listings, mayOpen),
          claimed: linkFor(links.claimed, mayOpen),
          recruit: label === "severe" ? linkFor(links.recruit, mayOpen) : null,
        },
      };
    })
    .filter((row) => stockBy.has(row.sectorId))
    .sort(bySupplyGap);

  // ── Needs a human today (B2) ──
  let needsHuman: OverviewView["needsHuman"];
  if (live.queue || live.reports) {
    const human: NeedsHumanRow[] = [];
    if (live.queue) {
      human.push({ key: "queue_over_sla", count: live.queue.overSla, href: linkFor(LINKS.queueOverdue, mayOpen), urgent: live.queue.overSla > 0 });
      human.push({ key: "conflicts", count: live.queue.conflicts, href: linkFor(LINKS.conflicts, mayOpen), urgent: live.queue.conflicts > 0 });
    }
    if (live.reports) {
      human.push({ key: "reports_over_sla", count: live.reports.overSla, href: linkFor(LINKS.reportsLate, mayOpen), urgent: live.reports.overSla > 0 });
      // The owner's answer, 1 Oct: 4h's own types, one row per type with anything open.
      for (const entry of live.reports.types) {
        if (entry.count === 0) continue;
        human.push({
          key: `report:${entry.type}`,
          count: entry.count,
          reportType: entry.type,
          href: linkFor(reportTypeLink(entry.type), mayOpen),
          urgent: false,
        });
      }
    }
    needsHuman = {
      rows: human,
      overdue: (live.queue?.overSla ?? 0) + (live.reports?.overSla ?? 0) + (live.queue?.conflicts ?? 0),
    };
  }

  // ── Plan mix (B5, B10) ──
  let planMix: OverviewView["planMix"];
  if (revenue) {
    const paying = live.planMix.reduce((sum, plan) => sum + plan.accounts, 0);
    const free = Math.max(0, live.claimed - paying);
    planMix = {
      claimed: live.claimed,
      conversion: snapshot.conversion,
      rows: [
        {
          key: "free",
          planId: null,
          planName: null,
          listPriceFils: null,
          accounts: free,
          share: shareOf(free, live.claimed),
          href: linkFor(LINKS.planFree, mayOpen),
        },
        ...live.planMix.map((plan) => ({
          key: `plan:${plan.planId}`,
          planId: plan.planId,
          planName: plan.planName,
          listPriceFils: plan.listPriceFils,
          accounts: plan.accounts,
          share: shareOf(plan.accounts, live.claimed),
          href: linkFor(planLink(plan.planId), mayOpen),
        })),
      ],
    };
  }

  const status = { ...live.status, href: live.status.state === "normal" ? null : linkFor(LINKS.status, mayOpen) };

  return {
    period: snapshot.period,
    previous: snapshot.previous,
    snapshotAt: snapshot.computedAt,
    now: live.now,
    tiles,
    figures: {
      listings: { value: live.listingsLive, publishedInPeriod: snapshot.publishedInPeriod },
      claimed: {
        value: live.claimed,
        live: live.claimedLive,
        listingsLive: live.listingsLive,
        share: shareOf(live.claimedLive, live.listingsLive),
        approvedInPeriod: snapshot.claimsApproved,
      },
      paid: { atEnd: snapshot.paid.atEnd, atStart: snapshot.paid.atStart, net: snapshot.paid.atEnd - snapshot.paid.atStart },
      ...(revenue
        ? {
            mrr: {
              endingFils: snapshot.mrr.endingFils,
              startingFils: snapshot.mrr.startingFils,
              change: changeOf(snapshot.mrr.endingFils, snapshot.mrr.startingFils),
              composition: snapshot.mrr.composition,
            },
          }
        : {}),
      quoted: {
        ...snapshot.quoted.current,
        previousFils: snapshot.quoted.previous.fils,
        change: changeOf(snapshot.quoted.current.fils, snapshot.quoted.previous.fils),
      },
      ...(live.queue
        ? { queue: { open: live.queue.open, overSla: live.queue.overSla, lastDecidedAt: live.queue.lastDecidedAt } }
        : {}),
    },
    chart: { months: snapshot.chart, geometry: chartGeometry(snapshot.chart) },
    categories: { rows, sectors: rows.length, rfqWindow: snapshot.rfqWindow },
    ...(needsHuman ? { needsHuman } : {}),
    ...(planMix ? { planMix } : {}),
    noGoodResult: snapshot.noGoodResult,
    otherQueues: live.otherQueues.map((queue) => ({ ...queue, href: linkFor(OTHER_QUEUE_LINKS[queue.key], mayOpen) })),
    status,
    warnings,
    opens: live.opens,
  };
}

// ── The click log ────────────────────────────────────────────────────────────

/**
 * Every kind of figure the overview links, as the click log names them. A key
 * is one of these, or one of them and a suffix — `report:review_dispute`,
 * `plan:basic` — and anything else is refused before it is stored.
 */
export const FIGURE_KINDS = [
  "listings",
  "claimed",
  "paid",
  "mrr",
  "quoted",
  "queue",
  "queue_over_sla",
  "conflicts",
  "reports_over_sla",
  "report",
  "free",
  "plan",
  "category",
  "category_listings",
  "category_claimed",
  "recruit",
  "search",
  "import_runs",
  "records_to_categorise",
  "products_without_specs",
  "open_calls",
  "past_due",
  "invoices_outstanding",
  "licences_expiring",
] as const;

export type FigureKind = (typeof FIGURE_KINDS)[number];

export function isFigureKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = /^([a-z_]+)(?::([a-z0-9_-]{1,40}))?$/.exec(value);
  return match !== null && (FIGURE_KINDS as readonly string[]).includes(match[1]!);
}

/** The figure's kind, which is what the footnote names. */
export function figureKind(key: string): FigureKind | null {
  const kind = key.split(":")[0]!;
  return (FIGURE_KINDS as readonly string[]).includes(kind) ? (kind as FigureKind) : null;
}
