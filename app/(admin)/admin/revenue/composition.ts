import type { MrrComposition } from "@/lib/billing/mrr-composition";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * MRR's composition as rows a screen prints — D-MRR, board 4a.
 *
 * One presenter, read by `/admin/revenue` under its plan mix and by `/admin`
 * under its own, so the sentence a finance reader checks on the overview is
 * the one they find on the board it links to. Exact to the fil wherever any
 * line is not a whole dirham: the point of the rows is that they add up, and
 * rounded lines would not.
 */

export interface CompositionRow {
  key: string;
  label: string;
  amount: string;
  /** `line` for a plan, `adjustment` for annual terms and other prices, `total` for the two sums. */
  role: "line" | "subtotal" | "adjustment" | "total";
}

function signed(fils: number, exact: boolean): string {
  const text = formatAED(Math.abs(fils) / 100, { style: exact ? "exact" : "display" });
  return fils < 0 ? `−${text}` : `+${text}`;
}

export function compositionRows(composition: MrrComposition): CompositionRow[] {
  const exact = [
    composition.atListFils,
    composition.annual.fils,
    composition.other.fils,
    composition.ledgerFils,
    ...composition.plans.map((plan) => plan.atListFils),
  ].some((fils) => fils % 100 !== 0);
  const money = (fils: number) => formatAED(fils / 100, { style: exact ? "exact" : "display" });

  const rows: CompositionRow[] = composition.plans.map((plan) => ({
    key: `plan:${plan.planId}`,
    label: t("composition.plan", {
      plan: plan.planName,
      n: formatCount(plan.accounts),
      price: formatAED(plan.listPriceFils / 100),
    }),
    amount: money(plan.atListFils),
    role: "line",
  }));
  rows.push({ key: "at_list", label: t("composition.at_list"), amount: money(composition.atListFils), role: "subtotal" });
  if (composition.annual.accounts > 0) {
    rows.push({
      key: "annual",
      label: t("composition.annual", { count: composition.annual.accounts, n: formatCount(composition.annual.accounts) }),
      amount: signed(composition.annual.fils, exact),
      role: "adjustment",
    });
  }
  if (composition.other.accounts > 0) {
    rows.push({
      key: "other",
      label: t("composition.other", { count: composition.other.accounts, n: formatCount(composition.other.accounts) }),
      amount: signed(composition.other.fils, exact),
      role: "adjustment",
    });
  }
  rows.push({ key: "ledger", label: t("composition.ledger"), amount: money(composition.ledgerFils), role: "total" });
  return rows;
}
