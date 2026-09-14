import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Footing, NotComputable, WorkingStep } from "./proposal-footing";
import { feeAmount } from "./proposal-words";

/**
 * Board `1n-s` — the working under a twelve-month figure, in words.
 *
 * B2: *every normalised cell shows its operation, in the cell, not in a tooltip
 * or a footnote.* So each step `twelveMonthFooting` took becomes one clause, and
 * the clauses are joined in the order they were taken: *× 12 months, plus
 * AED 6,000 mobilisation*.
 */

function stepWords(step: WorkingStep): string {
  switch (step.op) {
    case "months":
      return t("footing.step.months", { count: step.count, formatted: formatCount(step.count) });
    case "visits":
      return step.source === "entered"
        ? t("footing.step.visits_entered", { count: step.count, formatted: formatCount(step.count) })
        : t("footing.step.visits_cadence", {
            count: step.count,
            formatted: formatCount(step.count),
            cadence: t(`footing.cadence.${step.cadence}` as "footing.cadence.quarterly"),
          });
    case "area":
      return t("footing.step.area", { formatted: formatCount(step.sqft) });
    case "as_proposed":
      return t("footing.step.as_proposed");
    case "mobilisation":
      return t("footing.step.mobilisation", { amount: feeAmount(step.aed) });
    case "no_mobilisation_stated":
      return t("footing.step.no_mobilisation");
    case "term_shorter":
      return t("footing.step.term_shorter", { count: step.termMonths, formatted: formatCount(step.termMonths) });
  }
}

/** `× 12 months, plus AED 6,000 mobilisation`. */
export function workingWords(footing: Footing): string {
  return footing.working.map(stepWords).join(t("footing.join"));
}

/** Why a column has no twelve-month figure — B5, said rather than assumed. */
export function notComputableWords(reason: NotComputable, basisLabel: string): string {
  switch (reason) {
    case "needs_visits":
      return t("footing.cannot.visits");
    case "needs_area":
      return t("footing.cannot.area");
    case "fixed_fee_term":
      return t("footing.cannot.fixed_fee");
    case "unknown_volume":
      return t("footing.cannot.volume", { basis: basisLabel.toLowerCase() });
  }
}
