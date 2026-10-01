import { chartPercent, SUPPLY_GAP_RULE, type SupplyGapLabel } from "@/lib/console/overview-model";
import { CATEGORY_ROWS_SHOWN, type OverviewView, type OverviewWarning, type TileView } from "@/lib/console/overview-view";
import { SLA_DAYS } from "@/lib/console/sla";
import { FASTEST_REPORT_SLA_DAYS } from "@/lib/reports/sla";
import { CONFLICT_SLA_HOURS } from "@/lib/claims/clock";
import { CONVERSION_WINDOW_DAYS } from "@/lib/accounts/conversion-model";
import { FIRST_PAGE, NO_GOOD_RESULT_CANDIDATES } from "@/lib/search/no-good-result-rule";
import { formatAED, formatClock, formatCount, formatDateRange, formatDateShort, formatDecimal, formatMonth, formatPercent } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { compositionRows, type CompositionRow } from "../revenue/composition";

/**
 * Board 4a — the overview's one place a figure becomes text.
 *
 * Everything the screen prints is built here from the view `assembleOverview`
 * returns: the API hands out the same view, raw, and the gallery draws its
 * states through this function, so a state that reads wrong in the gallery
 * reads wrong on the console.
 */

const MINUS = "−";

export type Tone = "good" | "neutral" | "bad" | "warn";

export interface TileScreen {
  key: TileView["key"];
  label: string;
  /** The figure, without its currency where it has one. */
  value: string;
  /** `AED` on a money tile, printed a size down beside the figure. */
  unit?: string;
  /** `Now`, or the month — which tiles the picker moves (B4). */
  scope: string;
  scopeIsPeriod: boolean;
  /** Up to two lines under the value. */
  lines: { text: string; tone: Tone }[];
  href: string | null;
  /** The queue tile is the one red tile. */
  urgent: boolean;
  warnings: string[];
}

export interface ChartBar {
  key: string;
  label: string;
  /** Shown under the column: the last, and every third month back from it. */
  showLabel: boolean;
  partial: boolean;
  claims: number;
  upgrades: number;
  churn: number;
  rfqs: number;
  /** Heights as percentages of their side of the axis. */
  claimsPct: number;
  upgradesPct: number;
  rfqsPct: number;
  churnPct: number;
}

export interface ChartScreen {
  title: string;
  /** Percent of the plot above the axis. */
  upShare: number;
  ticks: { value: string; pct: number }[];
  downTicks: { value: string; pct: number }[];
  bars: ChartBar[];
  caption: string;
  tableCaption: string;
}

export interface CategoryRowScreen {
  key: string;
  name: string;
  listings: string;
  claimed: string;
  rfqs: string;
  ratio: string;
  label: SupplyGapLabel;
  labelText: string;
  links: OverviewView["categories"]["rows"][number]["links"];
}

export interface OverviewScreen {
  periodLabel: string;
  periodNote: string;
  snapshotNote: string;
  status: { tone: "ok" | "warn" | "bad"; label: string; href: string | null };
  tiles: TileScreen[];
  chart: ChartScreen;
  categories: {
    rows: CategoryRowScreen[];
    hidden: number;
    total: number;
    rule: string;
    window: string;
    noGap: boolean;
  };
  needsHuman: {
    rows: { key: string; label: string; count: string; href: string | null; urgent: boolean }[];
    clear: boolean;
    footnote: string;
  } | null;
  planMix: {
    rows: { key: string; label: string; count: string; share: string; pct: number; paid: boolean; href: string | null }[];
    conversion: string;
    composition: CompositionRow[];
  } | null;
  searches: {
    rows: { key: string; query: string; count: string; href: string }[];
    rule: string;
    empty: string | null;
  };
  otherQueues: { key: string; label: string; value: string; href: string | null }[];
  opens: string | null;
}

function money(fils: number): string {
  return formatAED(fils / 100, { style: fils % 100 === 0 ? "display" : "exact" });
}

/** A money figure as its currency and its digits, for a tile that sets them in two sizes. */
function moneyParts(fils: number): { unit: string; value: string } {
  return {
    unit: "AED",
    value: fils % 100 === 0 ? formatCount(fils / 100) : formatAED(fils / 100, { style: "quote" }),
  };
}

function signedCount(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : MINUS}${formatCount(Math.abs(value))}`;
}

function signedPercent(ratio: number): string {
  if (ratio === 0) return formatPercent(0, { decimals: 1 });
  return `${ratio > 0 ? "+" : MINUS}${formatPercent(Math.abs(ratio), { decimals: 1 })}`;
}

function warningText(warning: OverviewWarning): string {
  switch (warning.kind) {
    case "listings_home":
      return t("overview.warning.listings_home", { ours: formatCount(warning.ours), theirs: formatCount(warning.theirs) });
    case "paying_ledger":
      return t("overview.warning.paying_ledger", { ours: formatCount(warning.ours), theirs: formatCount(warning.theirs) });
    case "plan_column":
      return t("overview.warning.plan_column", { ours: formatCount(warning.ours), theirs: formatCount(warning.theirs) });
    case "unclaimed_payers":
      return t("overview.warning.unclaimed_payers", { count: warning.ours, n: formatCount(warning.ours) });
    case "mrr_ledger":
      return t("overview.warning.mrr_ledger", { ours: money(warning.ours), theirs: money(warning.theirs) });
  }
}

const GAP_LABEL: Record<SupplyGapLabel, MessageKey> = {
  severe: "overview.gap.severe",
  watch: "overview.gap.watch",
  healthy: "overview.gap.healthy",
  oversupplied: "overview.gap.oversupplied",
  no_demand: "overview.gap.no_demand",
};

function systemsText(systems: readonly string[]): string {
  return systems.map((system) => t(`maintenance.system.${system}` as MessageKey)).join(t("overview.status.join"));
}

export function presentOverview(view: OverviewView, options: { allSectors?: boolean } = {}): OverviewScreen {
  const month = formatMonth(view.period.from);
  const previousMonth = formatMonth(view.previous.from);
  const lastDay = new Date(new Date(view.period.to).getTime() - 1);
  const periodNote = view.period.partial
    ? t("overview.period.partial", { elapsed: String(view.period.daysElapsed), days: String(view.period.daysInMonth) })
    : t("overview.period.closed", { range: formatDateRange(view.period.from, lastDay) });
  const inMonth = view.period.partial ? t("overview.in_month_partial", { month }) : t("overview.in_month", { month });

  // ── Status chip (B9) ──
  const status: OverviewScreen["status"] =
    view.status.state === "normal"
      ? { tone: "ok", label: t("overview.status.normal"), href: null }
      : view.status.state === "planned"
        ? {
            tone: "warn",
            label: t("overview.status.planned", {
              time: formatClock(view.status.startsAt),
              systems: systemsText(view.status.systems),
            }),
            href: view.status.href,
          }
        : {
            tone: "bad",
            label: t(view.status.overrun ? "overview.status.overrun" : "overview.status.down", {
              systems: systemsText(view.status.systems),
              since: formatClock(view.status.since),
              until: formatClock(view.status.endsAt),
            }),
            href: view.status.href,
          };

  // ── Tiles ──
  const f = view.figures;
  const tiles: TileScreen[] = view.tiles.map((tile) => {
    const scope = tile.scope === "now" ? t("overview.scope.now") : month;
    const base = {
      key: tile.key,
      scope,
      scopeIsPeriod: tile.scope === "period",
      href: tile.href,
      urgent: false,
      warnings: tile.warnings.map(warningText),
    };
    switch (tile.key) {
      case "listings":
        return {
          ...base,
          label: t("overview.tile.listings"),
          value: formatCount(f.listings.value),
          lines: [
            {
              text: t("overview.tile.listings.published", { n: signedCount(f.listings.publishedInPeriod), when: inMonth }),
              tone: f.listings.publishedInPeriod > 0 ? "good" : "neutral",
            },
          ],
        };
      case "claimed": {
        const notLive = f.claimed.value - f.claimed.live;
        return {
          ...base,
          label: t("overview.tile.claimed"),
          value: formatCount(f.claimed.value),
          lines: [
            {
              text:
                f.claimed.share === null
                  ? t("overview.tile.claimed.no_listings")
                  : t("overview.tile.claimed.share", { share: formatPercent(f.claimed.share, { decimals: 1 }) }),
              tone: "neutral",
            },
            ...(notLive > 0
              ? [{ text: t("overview.tile.claimed.not_live", { count: notLive, n: formatCount(notLive) }), tone: "neutral" as Tone }]
              : []),
          ],
        };
      }
      case "paid":
        return {
          ...base,
          label: t("overview.tile.paid"),
          value: formatCount(f.paid.atEnd),
          lines: [
            {
              text:
                f.paid.net === 0
                  ? t("overview.tile.paid.flat", { when: inMonth })
                  : t("overview.tile.paid.net", { n: signedCount(f.paid.net), when: inMonth }),
              tone: f.paid.net > 0 ? "good" : f.paid.net < 0 ? "bad" : "neutral",
            },
          ],
        };
      case "mrr": {
        const mrr = f.mrr!;
        return {
          ...base,
          label: t("overview.tile.mrr"),
          ...moneyParts(mrr.endingFils),
          lines: [
            {
              text:
                mrr.change === null
                  ? t("overview.tile.mrr.from_nothing")
                  : t("overview.tile.mrr.change", {
                      change: signedPercent(mrr.change),
                      start: formatDateShort(view.period.from),
                    }),
              tone: mrr.change !== null && mrr.change > 0 ? "good" : mrr.change !== null && mrr.change < 0 ? "bad" : "neutral",
            },
          ],
        };
      }
      case "quoted": {
        const quoted = f.quoted;
        return {
          ...base,
          label: t("overview.tile.quoted"),
          ...moneyParts(quoted.fils),
          lines: [
            /*
               A month in progress is never compared with a whole one as a
               percentage — a day of October against all of September reads as
               a collapse. It states the previous month whole instead, which is
               the comparison a reader can make for themselves.
            */
            view.period.partial
              ? {
                  text:
                    quoted.previousFils === 0
                      ? t("overview.tile.quoted.no_previous", { month: previousMonth })
                      : t("overview.tile.quoted.previous_whole", { month: previousMonth, amount: money(quoted.previousFils) }),
                  tone: "neutral" as Tone,
                }
              : {
                  text:
                    quoted.change === null
                      ? t("overview.tile.quoted.no_previous", { month: previousMonth })
                      : t("overview.tile.quoted.change", { change: signedPercent(quoted.change), month: previousMonth }),
                  tone: quoted.change !== null && quoted.change > 0 ? ("good" as Tone) : ("neutral" as Tone),
                },
            {
              text:
                quoted.proposals > 0
                  ? t("overview.tile.quoted.counts_proposals", {
                      quotes: formatCount(quoted.quotes),
                      proposals: formatCount(quoted.proposals),
                    })
                  : t("overview.tile.quoted.counts", { count: quoted.quotes, n: formatCount(quoted.quotes) }),
              tone: "neutral",
            },
          ],
        };
      }
      case "queue": {
        const queue = f.queue!;
        return {
          ...base,
          label: t("overview.tile.queue"),
          value: formatCount(queue.open),
          // The one red tile — while something is waiting. An empty queue is
          // 4b's empty state, said plainly, not an alarm.
          urgent: queue.open > 0,
          lines: [
            queue.open === 0
              ? {
                  text: queue.lastDecidedAt
                    ? t("overview.tile.queue.cleared", { time: formatClock(queue.lastDecidedAt), day: formatDateShort(queue.lastDecidedAt) })
                    : t("overview.tile.queue.empty"),
                  tone: "neutral",
                }
              : {
                  text: t("overview.tile.queue.over_sla", { count: queue.overSla, n: formatCount(queue.overSla) }),
                  tone: queue.overSla > 0 ? "bad" : "neutral",
                },
          ],
        };
      }
    }
  });

  // ── The chart (B5, D-CHART) ──
  const geometry = view.chart.geometry;
  const bars: ChartBar[] = view.chart.months.map((point, index, all) => ({
    key: point.key,
    label: formatMonth(point.from),
    // Every third month back from the last, so the labels are evenly spaced
    // and the month on screen is always one of them.
    showLabel: (all.length - 1 - index) % 3 === 0,
    partial: point.partial,
    claims: point.claims,
    upgrades: point.upgrades,
    churn: point.churn,
    rfqs: point.rfqs,
    claimsPct: chartPercent(point.claims, geometry.upCeiling),
    upgradesPct: chartPercent(point.upgrades, geometry.upCeiling),
    rfqsPct: chartPercent(point.rfqs, geometry.upCeiling),
    churnPct: chartPercent(point.churn, geometry.downCeiling),
  }));
  const first = view.chart.months[0];
  const last = view.chart.months[view.chart.months.length - 1];
  const chart: ChartScreen = {
    title: t("overview.chart.title"),
    upShare: geometry.upShare * 100,
    ticks: geometry.ticks.map((value) => ({ value: formatCount(value), pct: chartPercent(value, geometry.upCeiling) })),
    downTicks: geometry.downTicks.map((value) => ({ value: formatCount(value), pct: chartPercent(value, geometry.downCeiling) })),
    bars,
    caption: t("overview.chart.caption"),
    tableCaption: t("overview.chart.table_caption", {
      from: first ? formatMonth(first.from) : month,
      to: last ? formatMonth(last.from) : month,
    }),
  };

  // ── Category health (B6, B7) ──
  const sorted = view.categories.rows;
  const shown = options.allSectors ? sorted : sorted.slice(0, CATEGORY_ROWS_SHOWN);
  const categories: OverviewScreen["categories"] = {
    rows: shown.map((row) => ({
      key: row.sectorId,
      name: row.name,
      listings: formatCount(row.listings),
      claimed: row.claimedShare === null ? "—" : formatPercent(row.claimedShare),
      rfqs: formatCount(row.rfqs),
      ratio:
        row.ratio === null
          ? "—"
          : Number.isFinite(row.ratio)
            ? formatDecimal(row.ratio, 2)
            : t("overview.gap.no_supply"),
      label: row.label,
      labelText: t(GAP_LABEL[row.label]),
      links: row.links,
    })),
    hidden: sorted.length - shown.length,
    total: sorted.length,
    rule: t("overview.categories.rule", {
      severe: formatDecimal(SUPPLY_GAP_RULE.severe, 0),
      watch: formatDecimal(SUPPLY_GAP_RULE.watch, 0),
      healthy: formatDecimal(SUPPLY_GAP_RULE.healthy, 1),
    }),
    window: t("overview.categories.window", {
      range: formatDateRange(view.categories.rfqWindow.from, new Date(new Date(view.categories.rfqWindow.to).getTime() - 1)),
    }),
    noGap: sorted.length > 0 && !sorted.some((row) => row.label === "severe"),
  };

  // ── Needs a human today (B2) ──
  const needsHuman: OverviewScreen["needsHuman"] = view.needsHuman
    ? {
        clear: view.needsHuman.overdue === 0,
        rows: view.needsHuman.rows.map((row) => ({
          key: row.key,
          label: row.reportType
            ? t(`admin.reports.type.${row.reportType}` as MessageKey)
            : t(`overview.human.${row.key}` as MessageKey),
          count: formatCount(row.count),
          href: row.href,
          urgent: row.urgent,
        })),
        footnote: t("overview.human.footnote", {
          claim: String(SLA_DAYS.claim),
          conflict: String(CONFLICT_SLA_HOURS),
          moderation: String(SLA_DAYS.moderation),
          reportFast: String(FASTEST_REPORT_SLA_DAYS),
          report: String(SLA_DAYS.report),
        }),
      }
    : null;

  // ── Plan mix (B5, B10, D-CONVERSION, D-MRR) ──
  let planMix: OverviewScreen["planMix"] = null;
  if (view.planMix) {
    const mix = view.planMix;
    const conversion = mix.conversion;
    const paid = mix.rows.filter((row) => row.planId !== null).reduce((sum, row) => sum + row.accounts, 0);
    const stockShare = mix.claimed > 0 ? paid / mix.claimed : null;
    planMix = {
      rows: mix.rows.map((row) => ({
        key: row.key,
        label:
          row.planId === null
            ? t("overview.plan.free")
            : t("overview.plan.paid", { plan: row.planName ?? row.planId, price: formatAED((row.listPriceFils ?? 0) / 100) }),
        count: formatCount(row.accounts),
        share: row.share === null ? "—" : formatPercent(row.share, { decimals: 1 }),
        pct: row.share === null ? 0 : Math.min(100, row.share * 100),
        paid: row.planId !== null,
        href: row.href,
      })),
      conversion:
        conversion.rate !== null && conversion.claimedFrom && conversion.claimedTo
          ? t("overview.plan.conversion_cohort", {
              rate: formatPercent(conversion.rate, { decimals: 1 }),
              converted: formatCount(conversion.converted),
              cohort: formatCount(conversion.cohort),
              days: String(CONVERSION_WINDOW_DAYS),
              range: formatDateRange(conversion.claimedFrom, conversion.claimedTo),
            })
          : stockShare === null
            ? t("overview.plan.conversion_none")
            : t("overview.plan.conversion_stock", {
                share: formatPercent(stockShare, { decimals: 1 }),
                days: String(CONVERSION_WINDOW_DAYS),
              }),
      composition: view.figures.mrr && view.figures.mrr.composition.ledgerFils > 0 ? compositionRows(view.figures.mrr.composition) : [],
    };
  }

  // ── Searches with no good result (D-NOGOOD) ──
  const searches: OverviewScreen["searches"] = {
    rows: view.noGoodResult.rows.map((row) => ({
      key: row.normalised,
      query: row.query,
      count: formatCount(row.searches),
      href: `/search?q=${encodeURIComponent(row.query)}`,
    })),
    rule: [
      t("overview.searches.rule", { page: String(FIRST_PAGE) }),
      ...(view.noGoodResult.checked > 0
        ? [t("overview.searches.checked", { checked: formatCount(view.noGoodResult.checked), top: formatCount(NO_GOOD_RESULT_CANDIDATES), month })]
        : []),
    ].join(" "),
    empty:
      view.noGoodResult.rows.length > 0
        ? null
        : view.noGoodResult.checked === 0
          ? t("overview.searches.none", { month })
          : t("overview.searches.all_good"),
  };

  // ── Other queues (the owner's answer, 1 Oct) ──
  const otherQueues = view.otherQueues.map((queue) => ({
    key: queue.key,
    label: t(`overview.other.${queue.key}` as MessageKey),
    value:
      queue.key === "invoices_outstanding" && queue.amountFils !== undefined
        ? t("overview.other.invoices_value", { n: formatCount(queue.count), amount: money(queue.amountFils) })
        : formatCount(queue.count),
    href: queue.href,
  }));

  const labelFor = (figure: string) => t(`overview.figure.${figure.split(":")[0]}` as MessageKey);
  const opens =
    view.opens.length === 0
      ? null
      : t("overview.opens", {
          list: view.opens.map((open) => t("overview.opens.item", { figure: labelFor(open.figure), n: formatCount(open.count) })).join(", "),
        });

  return {
    periodLabel: month,
    periodNote,
    snapshotNote: t("overview.snapshot", { time: formatClock(view.snapshotAt), day: formatDateShort(view.snapshotAt) }),
    status,
    tiles,
    chart,
    categories,
    needsHuman,
    planMix,
    searches,
    otherQueues,
    opens,
  };
}
