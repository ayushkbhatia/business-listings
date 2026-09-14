import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { parseAedToFils } from "./money";
import type { ProposalFigure, ProposalRefusal } from "./proposal";

/**
 * Board `3j-s` — how a proposal reads, wherever it is read.
 *
 * One module for the seller's lead, the pipeline, the thread, the buyer's
 * comparison, the accepted record and its PDF, so a fee cannot read
 * `AED 18,400 · Per month` on one surface and `18,400.00` on the next. Kept
 * apart from `proposal.ts` so the rules stay free of wording.
 */

/**
 * An amount, to the fils only where there are fils.
 *
 * `display` rounds to whole dirhams, which is right for a directory page and
 * wrong for a fee a buyer is agreeing to: `18,400.50` shown as `18,401` is a
 * number nobody offered. `exact` keeps them, and a whole fee reads without a
 * `.00` that would only be noise.
 */
export function feeAmount(aed: string): string {
  return parseAedToFils(aed) % 100n === 0n ? formatAED(aed) : formatAED(aed, { style: "exact" });
}

/**
 * An amount as it goes back into an input: `18,400` or `18,400.50`, without the
 * currency the field already carries. `readAmount` reads either back.
 */
export function typedAmount(aed: string): string {
  return formatAED(aed, { style: "quote" }).replace(/\.00$/, "");
}

/** `AED 18,400 · Per month` — the fee and the basis it is on, never one without the other. */
export function feeOnBasis(figure: Pick<ProposalFigure, "feeAed" | "feeBasisLabel">): string {
  return t("proposal.fee_on_basis", { amount: feeAmount(figure.feeAed), basis: figure.feeBasisLabel });
}

/**
 * `18,400.00 · Per month`, for a column whose head already carries the currency
 * — the quotes pipeline's *Quoted (AED)*.
 */
export function feeOnBasisInColumn(figure: Pick<ProposalFigure, "feeAed" | "feeBasisLabel">): string {
  return t("proposal.fee_on_basis", {
    amount: formatAED(figure.feeAed, { style: "quote" }),
    basis: figure.feeBasisLabel,
  });
}

/** `24 months`, or *Not stated*. */
export function termWords(months: number | null): string {
  return months === null
    ? t("proposal.not_stated")
    : t("proposal.term_months", { count: months, formatted: formatCount(months) });
}

/** `AED 6,000 one-off`, *No mobilisation charge*, or *Not stated*. */
export function mobilisationWords(aed: string | null): string {
  if (aed === null) return t("proposal.not_stated");
  if (parseAedToFils(aed) === 0n) return t("proposal.mobilisation_none");
  return t("proposal.mobilisation_amount", { amount: feeAmount(aed) });
}

/** The sentence under a field the send refused. Says what correct looks like. */
export function proposalRefusalWords(refusal: ProposalRefusal): string {
  switch (refusal.field) {
    case "service":
      return refusal.code === "required"
        ? t("proposal.error.service_required")
        : refusal.code === "no_basis"
          ? t("proposal.error.no_basis")
          : t("proposal.error.stale_basis");
    case "fee":
      return refusal.code === "required"
        ? t("proposal.error.fee_required")
        : refusal.code === "zero"
          ? t("proposal.error.fee_zero")
          : refusal.code === "too_large"
            ? t("proposal.error.amount_too_large")
            : t("proposal.error.not_amount");
    case "mobilisation":
      return refusal.code === "too_large" ? t("proposal.error.amount_too_large") : t("proposal.error.not_amount");
    case "term":
      return t("proposal.error.term");
    case "scope":
      return refusal.code === "required" ? t("proposal.error.scope_required") : t("proposal.error.too_long_text");
    case "deliverable":
    case "deliveredWhere":
      return t("proposal.error.too_long_line");
    case "exclusions":
      return t("proposal.error.too_long_text");
  }
}
