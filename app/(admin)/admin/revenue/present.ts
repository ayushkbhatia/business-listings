import type { MovementRow, MovementTone, StatCardProps } from "@/components/display";
import { CHURN_RISK_BELOW } from "@/lib/accounts/health";
import type { RevenueBoard } from "@/lib/billing/revenue-board";
import {
  WATERFALL_LINES,
  baseStoryOf,
  churnedFils,
  replyFindingKind,
  retainedFils,
  type WaterfallLine,
} from "@/lib/billing/revenue-period";
import { SCHEDULE } from "@/lib/billing/dunning";
import { WINDOW_DAYS } from "@/lib/metrics/response-time";
import { formatAED, formatCount, formatDateRange, formatMonth, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PlanMixRow } from "./PlanMixTable";

/**
 * Board 4g — the month, as the strings the page prints.
 *
 * Pure, and the only place a figure becomes text, so the page and the gallery
 * render the same sentences from the same numbers. Every ratio's formula is
 * assembled here from the same values the ratio was computed from: a formula
 * printed from one set of inputs beside a percentage computed from another
 * would be the board's original defect with more steps.
 *
 * ## Fils, when they exist
 *
 * An annual subscription is worth ten twelfths of a list price a month, which
 * is not a whole number of dirhams. Rounding every line of the waterfall to
 * whole dirhams can make nine printed numbers disagree with their own printed
 * total by a few dirhams, and "take each stated figure and do the arithmetic"
 * is the check the handoff asks for. So the waterfall and the MRR card print
 * fils whenever any of their figures has them, and whole dirhams when none do.
 */

const MINUS = "−";

export interface CardView extends Pick<StatCardProps, "label" | "value" | "caption" | "delta" | "note"> {
  key: string;
}

export interface ReasonView {
  key: string;
  label: string;
  count: string;
  /** 0 to 100, of the month's cancellations. */
  share: number;
  tone: "bad" | "warn" | "neutral";
}

export interface EmirateView {
  key: string;
  label: string;
  amount: string;
  share: string;
}

export interface RevenueView {
  periodKey: string;
  periodLabel: string;
  periodMeta: string;
  partial: boolean;
  cards: CardView[];
  waterfall: {
    title: string;
    empty: boolean;
    rows: MovementRow[];
    nrr: string;
  };
  reasons: {
    title: string;
    clear: string | null;
    rows: ReasonView[];
    finding: string | null;
    lapsed: string | null;
    closures: string | null;
  };
  emirates: { title: string; rows: EmirateView[]; empty: boolean };
  plans: { title: string; rows: PlanMixRow[] };
}

function whole(fils: number): boolean {
  return fils % 100 === 0;
}

function money(fils: number, exact: boolean): string {
  return formatAED(fils / 100, { style: exact ? "exact" : "display" });
}

/** A magnitude with no currency, for a column whose title carries it. */
function amount(fils: number, exact: boolean): string {
  const abs = Math.abs(fils) / 100;
  return exact ? formatAED(abs, { style: "quote" }) : formatCount(Math.round(abs));
}

function signedAmount(fils: number, exact: boolean): string {
  if (fils === 0) return amount(0, exact);
  return `${fils > 0 ? "+" : MINUS}${amount(fils, exact)}`;
}

function percent(ratio: number, decimals: number): string {
  return formatPercent(ratio, { decimals });
}

function signedPercent(ratio: number, decimals: number): string {
  if (ratio === 0) return `±${percent(0, decimals)}`;
  return `${ratio > 0 ? "+" : MINUS}${percent(Math.abs(ratio), decimals)}`;
}

function direction(value: number): "up" | "down" | "flat" {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

const LINE_TONE: Record<WaterfallLine, MovementTone> = {
  new_business: "gain",
  reactivation: "gain",
  upgrades: "gain",
  downgrades: "loss",
  term_changes: "neutral",
  cancellations: "churn",
  lapsed: "churn",
};

const REASON_TONE: Record<string, ReasonView["tone"]> = {
  not_enough_enquiries: "bad",
  too_expensive: "warn",
  poor_quality_enquiries: "warn",
};

export function presentRevenue(board: RevenueBoard): RevenueView {
  const { current, previous } = board;
  const { period, month, ratios } = current;
  const monthName = formatMonth(period.from);
  const previousName = formatMonth(previous.period.from);
  const inMonth = period.partial
    ? t("admin.revenue.in_month_partial", { month: monthName })
    : t("admin.revenue.in_month", { month: monthName });

  const waterfallFils = [month.startingFils, current.endingFils, ...WATERFALL_LINES.map((line) => month.lines[line])];
  const exact = !waterfallFils.every(whole);

  // ── Cards ──────────────────────────────────────────────────────────────────

  const mrr: CardView = {
    key: "mrr",
    label: t("admin.revenue.card.mrr"),
    value: money(current.endingFils, exact),
    caption: t(period.partial ? "admin.revenue.card.mrr_caption_partial" : "admin.revenue.card.mrr_caption", {
      starting: money(month.startingFils, exact),
    }),
    ...(ratios.monthOnMonth === null
      ? { note: t("admin.revenue.card.no_starting") }
      : {
          delta: {
            value: signedPercent(ratios.monthOnMonth, 1),
            direction: direction(ratios.monthOnMonth),
            label: t(period.partial ? "admin.revenue.card.mom_partial" : "admin.revenue.card.mom"),
            sentiment: ratios.monthOnMonth > 0 ? "good" : ratios.monthOnMonth < 0 ? "bad" : "neutral",
          },
        }),
  };

  const placementChange =
    !period.partial && previous.placement.fils > 0
      ? (current.placement.fils - previous.placement.fils) / previous.placement.fils
      : null;
  const placement: CardView = {
    key: "placement",
    label: t("admin.revenue.card.placement"),
    value: money(current.placement.fils, false),
    caption: t("admin.revenue.card.placement_caption", {
      count: current.placement.slots,
      slots: formatCount(current.placement.slots),
    }),
    note: t("admin.revenue.card.placement_note"),
    ...(placementChange === null
      ? {}
      : {
          delta: {
            value: signedPercent(placementChange, 0),
            direction: direction(placementChange),
            label: t("admin.revenue.card.vs", { month: previousName }),
            sentiment: "neutral" as const,
          },
        }),
  };

  const arpaChange =
    ratios.arpaFils !== null && previous.ratios.arpaFils !== null ? ratios.arpaFils - previous.ratios.arpaFils : null;
  const arpa: CardView = {
    key: "arpa",
    label: t("admin.revenue.card.arpa"),
    value: ratios.arpaFils === null ? "—" : money(ratios.arpaFils, false),
    caption:
      ratios.arpaFils === null
        ? t("admin.revenue.card.arpa_none")
        : t("admin.revenue.card.arpa_formula", {
            count: month.payingAtEnd,
            ending: money(current.endingFils, exact),
            accounts: formatCount(month.payingAtEnd),
          }),
    ...(arpaChange === null || period.partial
      ? {}
      : {
          delta: {
            value: `${arpaChange > 0 ? "+" : arpaChange < 0 ? MINUS : "±"}${money(Math.abs(arpaChange), false)}`,
            direction: direction(arpaChange),
            label: t("admin.revenue.card.vs", { month: previousName }),
            sentiment: "neutral" as const,
          },
        }),
  };

  const churned = churnedFils(month);
  const churnAccounts = month.cancelledAccounts + month.lapsedAccounts;
  const churnChange =
    ratios.revenueChurn !== null && previous.ratios.revenueChurn !== null && !period.partial
      ? ratios.revenueChurn - previous.ratios.revenueChurn
      : null;
  const churn: CardView = {
    key: "churn",
    label: t("admin.revenue.card.churn"),
    value: ratios.revenueChurn === null ? "—" : percent(ratios.revenueChurn, 2),
    caption:
      ratios.revenueChurn === null
        ? t("admin.revenue.card.no_starting")
        : t("admin.revenue.card.churn_formula", {
            churned: money(churned, exact),
            starting: money(month.startingFils, exact),
          }),
    note:
      ratios.customerChurn === null
        ? t("admin.revenue.card.customer_churn_none")
        : t("admin.revenue.card.customer_churn", {
            rate: percent(ratios.customerChurn, 2),
            churned: formatCount(churnAccounts),
            count: month.payingAtStart,
            accounts: formatCount(month.payingAtStart),
          }),
    ...(churnChange === null
      ? {}
      : {
          delta: {
            // Points, never percent: a rate that moved from 3.5% to 3.9% rose
            // 0.4 points, and "rose 11%" beside a percentage misleads.
            value: `${churnChange > 0 ? "+" : churnChange < 0 ? MINUS : "±"}${t("admin.revenue.card.points", {
              points: (Math.abs(churnChange) * 100).toFixed(2),
            })}`,
            direction: direction(churnChange),
            label: t("admin.revenue.card.vs", { month: previousName }),
            sentiment: churnChange > 0 ? "bad" : churnChange < 0 ? "good" : "neutral",
          },
        }),
  };

  const failed: CardView = {
    key: "failed",
    label: t("admin.revenue.card.failed"),
    value: formatCount(current.failedPayments.accounts),
    caption: t("admin.revenue.card.failed_caption", { amount: money(current.failedPayments.atRiskFils, false) }),
    note: t(period.partial ? "admin.revenue.card.failed_note_partial" : "admin.revenue.card.failed_note", {
      days: String(SCHEDULE.final),
    }),
  };

  // ── Waterfall ──────────────────────────────────────────────────────────────

  const rows: MovementRow[] = [
    {
      key: "starting",
      label: t("admin.revenue.line.starting"),
      value: month.startingFils,
      valueLabel: amount(month.startingFils, exact),
      tone: "start",
    },
    ...WATERFALL_LINES.map((line) => ({
      key: line,
      label: t(`admin.revenue.line.${line}` as never),
      value: month.lines[line],
      valueLabel: signedAmount(month.lines[line], exact),
      tone: LINE_TONE[line],
    })),
    {
      key: "ending",
      label: t("admin.revenue.line.ending"),
      value: current.endingFils,
      valueLabel: amount(current.endingFils, exact),
      tone: "end",
    },
  ];

  /*
     B2 and B3. The formula names every base line that moved, in the waterfall's
     order and with the waterfall's signs, so the reader can put a finger on each
     term above. Lines that did not move are left out of the sum rather than
     printed as `+ 0`; they are on the chart as zero.
  */
  const terms = WATERFALL_LINES.filter((line) => line !== "new_business" && line !== "reactivation")
    .filter((line) => month.lines[line] !== 0)
    .map((line) => ` ${month.lines[line] > 0 ? "+" : MINUS} ${amount(month.lines[line], exact)}`)
    .join("");
  const story = baseStoryOf(month);
  const nrr =
    ratios.nrr === null
      ? t("admin.revenue.nrr_none")
      : `${t("admin.revenue.nrr_formula", {
          rate: percent(ratios.nrr, 1),
          formula: `(${amount(month.startingFils, exact)}${terms}) ÷ ${amount(month.startingFils, exact)}`,
          retained: amount(retainedFils(month), exact),
        })} ${t(`admin.revenue.nrr_story.${story}` as never)}`;

  // ── Reasons ────────────────────────────────────────────────────────────────

  const finding = board.replyFinding;
  const threshold = percent(CHURN_RISK_BELOW, 0);
  const findingKind = replyFindingKind(finding);
  const unmeasuredTail =
    finding.unmeasured > 0 && findingKind !== "all_unmeasured"
      ? ` ${t("admin.revenue.finding.unmeasured_tail", { count: finding.unmeasured, n: formatCount(finding.unmeasured), days: String(WINDOW_DAYS) })}`
      : "";
  const findingText =
    findingKind === "none"
      ? null
      : findingKind === "below"
        ? `${t("admin.revenue.finding.below", {
            count: finding.total,
            below: formatCount(finding.below),
            total: formatCount(finding.total),
            threshold,
          })}${unmeasuredTail}`
        : findingKind === "none_below"
          ? `${t("admin.revenue.finding.none_below", { count: finding.total, total: formatCount(finding.total), threshold })}${unmeasuredTail}`
          : t("admin.revenue.finding.all_unmeasured", {
              count: finding.total,
              total: formatCount(finding.total),
              days: String(WINDOW_DAYS),
            });

  const reasons = {
    title: t("admin.revenue.reasons.title", { count: board.cancellations, n: formatCount(board.cancellations), when: inMonth }),
    clear:
      board.cancellations === 0
        ? t(period.partial ? "admin.revenue.reasons.clear_partial" : "admin.revenue.reasons.clear", { month: monthName })
        : null,
    rows:
      board.cancellations === 0
        ? []
        : board.reasons.map((row) => ({
            key: row.reason,
            label: t(`admin.revenue.reason.${row.reason}` as never),
            count: formatCount(row.count),
            share: (row.count / board.cancellations) * 100,
            tone: REASON_TONE[row.reason] ?? ("neutral" as const),
          })),
    finding: findingText,
    lapsed:
      month.lapsedAccounts > 0
        ? t("admin.revenue.reasons.lapsed", {
            count: month.lapsedAccounts,
            n: formatCount(month.lapsedAccounts),
            days: String(SCHEDULE.final),
          })
        : null,
    closures:
      board.closures > 0
        ? t("admin.revenue.reasons.closures", { count: board.closures, n: formatCount(board.closures), when: inMonth })
        : null,
  };

  // ── Emirates and plans ─────────────────────────────────────────────────────

  const emirates = {
    title: t("admin.revenue.emirates.title"),
    empty: current.endingFils === 0,
    rows: board.byEmirate.map((row) => ({
      key: row.emirate,
      label: t(`emirate.${row.emirate}` as never),
      amount: money(row.mrrFils, false),
      // One decimal, so the column reads as a whole: whole percentages of four
      // emirates round to 101 as often as not.
      share: current.endingFils === 0 ? "—" : percent(row.mrrFils / current.endingFils, 1),
    })),
  };

  const plans = {
    title: t(period.partial ? "admin.revenue.by_plan_partial" : "admin.revenue.by_plan", { month: monthName }),
    rows: board.byPlan.map((plan) => ({
      planId: plan.planId,
      planName: plan.planName,
      accounts: formatCount(plan.accounts),
      mrr: money(plan.mrrFils, exact),
      share: current.endingFils === 0 ? "—" : percent(plan.mrrFils / current.endingFils, 1),
      arpa: plan.accounts === 0 ? "—" : money(Math.round(plan.mrrFils / plan.accounts), false),
    })),
  };

  // ── Period ─────────────────────────────────────────────────────────────────

  const lastDay = new Date(period.to.getTime() - 1);
  const periodMeta = period.partial
    ? t("admin.revenue.meta_partial", {
        range: formatDateRange(period.from, lastDay),
        elapsed: String(period.daysElapsed),
        days: String(period.daysInMonth),
      })
    : t("admin.revenue.meta_closed", { range: formatDateRange(period.from, lastDay) });

  return {
    periodKey: period.key,
    periodLabel: monthName,
    periodMeta,
    partial: period.partial,
    cards: [mrr, placement, arpa, churn, failed],
    waterfall: {
      title: t("admin.revenue.waterfall_title", { when: inMonth }),
      empty: month.startingFils === 0 && current.endingFils === 0 && WATERFALL_LINES.every((line) => month.lines[line] === 0),
      rows,
      nrr,
    },
    reasons,
    emirates,
    plans,
  };
}
