import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { comparisonCsv, exportFilename, type ComparisonSheet } from "@/lib/export/comparison-csv";
import type { CompareCell, CompareRow, Comparison } from "./table";

/**
 * Board `10d` — the product comparison as a CSV, on the exporter board `1n`
 * specified for both (`1n` flag 5: *two boards now offer an export nobody has
 * defined*).
 *
 * The table exactly as the screen builds it — the template's rows in the
 * template's order, a column per product in the order the buyer chose — worded
 * with the screen's own catalogue keys, so a cell reads the same in the file as
 * on the page: *Not provided* for a gap, never a blank that could be mistaken
 * for a value. No price anywhere, because a product has none.
 */

const AVAILABILITY_KEY = {
  in_stock: "availability.in_stock",
  made_to_order: "availability.made_to_order",
  indent: "availability.indent",
  out_of_stock: "availability.out_of_stock",
} as const;

/** One cell in words, as the comparison table says it. */
export function cellWords(row: CompareRow, cell: CompareCell): string {
  if (row.kind === "availability") {
    const state = t(AVAILABILITY_KEY[(cell.text ?? "out_of_stock") as keyof typeof AVAILABILITY_KEY]);
    return [
      state,
      cell.stockQty != null ? t("product.in_stock_qty", { qty: formatCount(cell.stockQty) }) : null,
      cell.leadTimeDays != null ? t("product.lead_time", { days: cell.leadTimeDays }) : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
  }
  if (row.kind === "reply") {
    return cell.replyMs ? t("response.median", { duration: formatDuration(cell.replyMs) }) : t("response.unmeasured");
  }
  if (row.kind === "completeness") {
    return t("display.fields_filled", { filled: cell.filled ?? 0, total: cell.total ?? 0 });
  }
  if (cell.text === null) return t("table.not_provided");
  return cell.unit ? `${cell.text} ${cell.unit}` : cell.text;
}

export function productComparisonSheet(input: {
  trade: string;
  columns: readonly { name: string; seller: string }[];
  comparison: Comparison;
}): ComparisonSheet {
  const count = input.columns.length;
  return {
    caveat: t("compare.csv.caveat", { count, formatted: formatCount(count), trade: input.trade }),
    head: [t("compare.csv.field"), ...input.columns.map((column) => t("compare.csv.column", { product: column.name, seller: column.seller }))],
    rows: input.comparison.rows.map((row) => [row.label, ...row.cells.map((cell) => cellWords(row, cell))]),
  };
}

export function productComparisonCsv(input: Parameters<typeof productComparisonSheet>[0]): { filename: string; csv: string } {
  return {
    filename: exportFilename(input.trade || "products", "comparison"),
    csv: comparisonCsv(productComparisonSheet(input)),
  };
}
