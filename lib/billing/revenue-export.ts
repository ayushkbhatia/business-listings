import { csvField } from "@/lib/import/csv";
import { CHURN_RISK_BELOW } from "@/lib/accounts/health";
import { MIN_SAMPLE, WINDOW_DAYS } from "@/lib/metrics/response-time";
import type { RevenueBoard } from "./revenue-board";
import { WATERFALL_LINES, churnedFils } from "./revenue-period";

/**
 * Board 4g `B10` — the month, for finance, carrying its period, its formulas
 * and its filter.
 *
 * A figure pasted into a spreadsheet has to be traceable back to the rows that
 * made it, so the file is three things in one table:
 *
 *   1. `#` lines: the period, its boundaries in UTC, when it was taken, the
 *      filter it was asked for, and every formula the board prints.
 *   2. The board's figures, one row each, with the account count behind each.
 *   3. Every ledger movement in the month, on the waterfall line it counts on,
 *      with the cancellation reason where there is one.
 *
 * One header for all of it rather than three tables stacked in one file, which
 * no importer reads. Amounts are AED with two decimals, from fils, so a column
 * sum is exact. Numbers are written bare: `csvField` guards text against being
 * read as a formula by prefixing a leading minus, which is right for a name and
 * would turn every contraction into a string.
 *
 * Every ratio row carries the ratio as a decimal. The file states the formula
 * and the inputs; it does not round a percentage for a reader to re-round.
 */

export const REVENUE_EXPORT_HEADER = [
  "section",
  "line",
  "business_id",
  "display_name",
  "licence_emirate",
  "occurred_at_utc",
  "aed",
  "accounts",
  "ratio",
  "detail",
] as const;

type Cell = string | number | null;

function aed(fils: number): string {
  // Integer arithmetic, not division, so 0.1 + 0.2 never reaches the file.
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function ratio(value: number | null): string | null {
  return value === null ? null : value.toFixed(6);
}

function line(cells: readonly Cell[]): string {
  return `${cells
    .map((cell) => {
      if (cell === null) return "";
      if (typeof cell === "number") return String(cell);
      // Amounts and ratios arrive as strings of digits; they are numbers to a
      // spreadsheet and must not be prefixed.
      if (/^-?\d+(\.\d+)?$/.test(cell)) return cell;
      return csvField(cell);
    })
    .join(",")}\r\n`;
}

function row(section: string, name: string, values: { aed?: number; accounts?: number; ratio?: number | null; detail?: string }): string {
  return line([
    section,
    name,
    null,
    null,
    null,
    null,
    values.aed === undefined ? null : aed(values.aed),
    values.accounts ?? null,
    values.ratio === undefined ? null : ratio(values.ratio),
    values.detail ?? null,
  ]);
}

export function revenueExportFilename(board: RevenueBoard): string {
  const { period } = board.current;
  return `revenue-${period.key}${period.partial ? "-partial" : ""}.csv`;
}

export function revenueCsv(board: RevenueBoard, exportedAt: Date): string {
  const { current } = board;
  const { period, month, ratios } = current;
  const threshold = `${Math.round(CHURN_RISK_BELOW * 100)}%`;

  const out: string[] = [
    line(["# report", "Subscriptions and revenue, board 4g"]),
    line(["# filter", `period=${period.key}`]),
    line([
      "# period",
      period.key,
      period.partial ? `partial: ${period.daysElapsed} of ${period.daysInMonth} days, not comparable with a whole month` : "closed month",
    ]),
    line(["# boundaries_utc", period.from.toISOString(), period.to.toISOString(), "Dubai calendar month, midnight to midnight at UTC+4"]),
    line(["# exported_at_utc", exportedAt.toISOString()]),
    line(["# formula", "ending_mrr", "starting_mrr + new_business + reactivation + upgrades + downgrades + term_changes + cancellations + lapsed, each line signed"]),
    line(["# formula", "net_revenue_retention", "(starting_mrr + upgrades + downgrades + term_changes + cancellations + lapsed) / starting_mrr; excludes new_business and reactivation"]),
    line(["# formula", "revenue_churn", "(cancellations + lapsed), as a positive amount, / starting_mrr"]),
    line(["# formula", "customer_churn", "(accounts cancelled + accounts lapsed) / paying accounts at the start"]),
    line(["# formula", "arpa", "ending_mrr / paying accounts at the end; placement not included"]),
    line(["# formula", "month_on_month", "(ending_mrr - starting_mrr) / starting_mrr"]),
    line(["# formula", "placement", "sum over slots of monthly list price x time live in the period / length of the month; not in MRR or ARPA"]),
    line(["# definition", "mrr", "active and past-due subscriptions at their monthly value, from the mrr_movement ledger; trials and Free are not revenue"]),
    line(["# definition", "failed_payments", "last payment attempt before the end failed and the account still pays; held out of churn until the day-14 drop"]),
    line([
      "# definition",
      "reply_check",
      `cancellations giving not_enough_enquiries, measured over the ${WINDOW_DAYS} days before the request; below ${threshold} is below the board 4f threshold; fewer than ${MIN_SAMPLE} counted enquiries is unmeasured`,
    ]),
    line(["# definition", "closures", "accounts closed through close account in the period; reported apart from churn"]),
    line(REVENUE_EXPORT_HEADER),
  ];

  out.push(row("summary", "starting_mrr", { aed: month.startingFils, accounts: month.payingAtStart }));
  for (const name of WATERFALL_LINES) {
    const accounts = new Set(current.movements.filter((movement) => movement.line === name).map((movement) => movement.businessId));
    out.push(row("waterfall", name, { aed: month.lines[name], accounts: accounts.size }));
  }
  out.push(row("summary", "ending_mrr", { aed: current.endingFils, accounts: month.payingAtEnd }));
  out.push(row("summary", "month_on_month", { ratio: ratios.monthOnMonth }));
  out.push(row("summary", "net_revenue_retention", { ratio: ratios.nrr }));
  out.push(row("summary", "revenue_churn", { aed: churnedFils(month), ratio: ratios.revenueChurn }));
  out.push(
    row("summary", "customer_churn", {
      accounts: month.cancelledAccounts + month.lapsedAccounts,
      ratio: ratios.customerChurn,
      detail: `of ${month.payingAtStart} paying at the start`,
    }),
  );
  out.push(row("summary", "arpa", { aed: ratios.arpaFils ?? 0, accounts: month.payingAtEnd }));
  out.push(row("summary", "placement", { aed: current.placement.fils, accounts: current.placement.slots, detail: "slots live in the period" }));
  out.push(row("summary", "failed_payments", { aed: current.failedPayments.atRiskFils, accounts: current.failedPayments.accounts, detail: "at risk, not lost" }));
  out.push(row("summary", "closures", { accounts: board.closures }));

  for (const reason of board.reasons) out.push(row("reason", reason.reason, { accounts: reason.count }));
  out.push(row("reply_check", "not_enough_enquiries", { accounts: board.replyFinding.total }));
  out.push(row("reply_check", "below_threshold", { accounts: board.replyFinding.below }));
  out.push(row("reply_check", "at_or_above_threshold", { accounts: board.replyFinding.atOrAbove }));
  out.push(row("reply_check", "unmeasured", { accounts: board.replyFinding.unmeasured }));

  for (const emirate of board.byEmirate) out.push(row("emirate", emirate.emirate, { aed: emirate.mrrFils, accounts: emirate.accounts }));
  for (const plan of board.byPlan) out.push(row("plan", plan.planId, { aed: plan.mrrFils, accounts: plan.accounts }));

  for (const movement of current.movements) {
    out.push(
      line([
        "movement",
        movement.line,
        movement.businessId,
        movement.displayName,
        movement.licenceEmirate,
        movement.occurredAt.toISOString(),
        aed(movement.deltaFils),
        null,
        null,
        [
          `${movement.kind}, ${movement.cause}`,
          `${movement.fromPlanId ?? "none"} to ${movement.toPlanId ?? "none"}`,
          `mrr after ${aed(movement.mrrAfterFils)}`,
          movement.cancelReason ? `reason ${movement.cancelReason}` : null,
        ]
          .filter(Boolean)
          .join("; "),
      ]),
    );
  }

  return out.join("");
}
