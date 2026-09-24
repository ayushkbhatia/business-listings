import { tierSpec } from "@/components/domain/verification";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { comparisonCsv, exportFilename, type ComparisonSheet } from "@/lib/export/comparison-csv";
import type { QuoteComparisonData } from "@/lib/db/queries/quote-comparison";
import { winnersOf, type QuoteComparisonModel } from "./comparison";
import { filsToAed } from "./money";

/**
 * Board `1n` — *Export comparison*, flag 5's unspecified button, specified.
 *
 * The comparison as a CSV: one row per supplier the enquiry reached, one column
 * per line of the buyer's requirement, each cell the supplier's price for that
 * line, and a closing row naming the lowest per line — the same marks the
 * screen draws in green, from the same model, so the file and the page cannot
 * disagree. Excluding VAT and said so on the first line (`B6`).
 *
 * The buyer's own file of prices sent to them alone. Nothing here is a seller
 * surface, and no seller surface reads it.
 */
export function quoteComparisonSheet(data: QuoteComparisonData, model: QuoteComparisonModel): ComparisonSheet {
  const head = [
    t("compare_quotes.csv.supplier"),
    t("compare_quotes.csv.quote"),
    t("compare_quotes.csv.status"),
    t("compare_quotes.csv.verification"),
    ...model.lines.map((line) =>
      t("compare_quotes.csv.line", {
        line: [line.description, line.size].filter(Boolean).join(" "),
        qty: line.qty === null ? "" : ` ×${formatCount(line.qty)}`,
      }),
    ),
    t("compare_quotes.csv.lines_quoted"),
    t("compare_quotes.csv.lead_days"),
    t("compare_quotes.csv.total"),
    t("compare_quotes.csv.payment"),
    t("compare_quotes.csv.delivery"),
    t("compare_quotes.csv.valid_until"),
  ];

  const rows = model.rows.map((row) => {
    const verification = t(tierSpec(row.supplier.verificationTier).labelKey as never);
    if (row.kind !== "quoted") {
      const status =
        row.kind === "waiting"
          ? row.repliedAt
            ? t("compare_quotes.csv.state.replied")
            : row.state === "opened"
              ? t("compare_quotes.csv.state.opened")
              : t("compare_quotes.csv.state.delivered")
          : row.declinedBySupplier
            ? row.declineReason
              ? t("compare_quotes.no_quote.declined_reason", { reason: row.declineReason })
              : t("compare_quotes.no_quote.declined")
            : t("compare_quotes.no_quote.none");
      return [row.supplier.displayName, null, status, verification];
    }
    return [
      row.supplier.displayName,
      row.quote.ref,
      t(`compare_quotes.csv.state.${row.state}` as "compare_quotes.csv.state.open"),
      verification,
      ...row.cells.map((cell) => (cell.kind === "priced" ? filsToAed(cell.totalFils) : t("compare_quotes.not_quoted"))),
      t("compare_quotes.total.partial", { quoted: row.quotedLines, total: row.totalLines }),
      row.leadTimeDays,
      filsToAed(row.totalFils),
      row.quote.paymentTerms ? t(`terms.${row.quote.paymentTerms}` as "terms.net_30") : t("accepted.not_stated"),
      row.quote.delivery ? t(`compare.delivery.${row.quote.delivery}` as "compare.delivery.included") : t("accepted.not_stated"),
      row.quote.expiresAt ? row.quote.expiresAt.toISOString().slice(0, 10) : null,
    ];
  });

  // The green marks, as a row: which supplier is lowest on each line, by name.
  const winners = winnersOf(model);
  const names = new Map(model.rows.map((row) => [row.supplier.businessId, row.supplier.displayName]));
  const foot =
    winners.size > 0
      ? [
          [
            t("compare_quotes.csv.lowest"),
            null,
            null,
            null,
            ...model.lines.map((line) => {
              const businessId = winners.get(line.id);
              return businessId ? (names.get(businessId) ?? null) : null;
            }),
          ],
        ]
      : [];

  return {
    caveat: t("compare_quotes.csv.caveat", { ref: data.enquiry.ref }),
    head,
    rows,
    foot,
  };
}

export function quoteComparisonCsv(data: QuoteComparisonData, model: QuoteComparisonModel): { filename: string; csv: string } {
  return {
    filename: exportFilename(data.enquiry.ref, "quotes"),
    csv: comparisonCsv(quoteComparisonSheet(data, model)),
  };
}
