import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ScopeRow } from "@/lib/services/scope-sheet";

/**
 * The comparison instrument — boards `1g-s` and `8c-s`.
 *
 * Extracted from the public service page because `8c-s` B11 asks for the setup
 * screen's live preview to be **a real render of `1g-s`, not a mock**: *"if the
 * two drift, the preview is lying at the worst moment"*. The only way to keep
 * that true is for there to be one component, which is also `CLAUDE.md`'s own
 * rule — *a shared component renders identically on every screen that carries
 * it* — and the most repeated defect in this project.
 *
 * Presentational, server-safe, and it owns no data loading: the public page
 * feeds it `publicServiceFor`'s rows and the preview feeds it the rows for the
 * service the seller is typing. A component that fetched would have forced the
 * preview to write a draft before it could show one.
 *
 * ## Every row, filled or not
 *
 * `1g-s` B2 asks for unfilled rows to be omitted. `CLAUDE.md` § Interface
 * honesty says the opposite about the table this one replaces — *"Unfilled spec
 * rows render grey reading 'Not provided', never hidden. The buyer sees what is
 * unanswered and the request becomes high-intent"* — and the repository rule
 * wins. The board's own render settles it on the board's terms too: it prints
 * "9 of 12 rows are filled" under a table it has hidden them from, so a buyer
 * is told three rows are unanswered and cannot see which.
 */
export interface ScopeTableProps {
  rows: readonly ScopeRow[];
  /** Filled and total, for the line under the table. */
  filled: number;
  total: number;
  /**
   * Smaller type and tighter rows, for the preview pane.
   *
   * The only thing the two mounts differ by, and it is density rather than
   * content — a preview that dropped a row would be the drift B11 forbids.
   */
  density?: "page" | "preview";
}

export function ScopeTable({ rows, filled, total, density = "page" }: ScopeTableProps) {
  const compact = density === "preview";

  return (
    <>
      <div className="overflow-x-auto">
        <table className={cn("w-full border-collapse", compact ? "text-caption" : "text-body-sm")}>
          {/* Named, not explained. The panel's description says why the rows
              are the same on every firm; a caption repeating it is a screen
              reader hearing the sentence twice. */}
          <caption className="sr-only">{t("service_public.table_title")}</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-line last:border-b-0">
                <th
                  scope="row"
                  className={cn(
                    "text-start align-top font-normal text-muted",
                    compact ? "w-[8rem] py-1.5 pe-3" : "w-[14rem] py-2.5 pe-4",
                  )}
                >
                  {row.label}
                </th>
                <td
                  className={cn(
                    "align-top",
                    compact ? "py-1.5" : "py-2.5",
                    row.value ? "text-ink" : "text-faint",
                  )}
                >
                  {row.value === null ? t("service_public.not_provided") : scopeWords(row.key, row.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={cn("text-caption text-muted", compact ? "mt-2" : "mt-3")}>
        {t("service_public.rows_filled", {
          filled: formatCount(filled),
          total: formatCount(total),
        })}
      </p>
    </>
  );
}

/**
 * The two enum columns, in words.
 *
 * Exported because the chips above the table on `1g-s` render the same values
 * and had their own copy of this — two functions turning `ongoing_contract`
 * into "Ongoing contract" is one function away from them disagreeing.
 */
export function scopeWords(key: string, value: string): string {
  if (key === "engagement_type") {
    return t(`engagement.${value}` as "engagement.ongoing_contract") || value;
  }
  if (key === "delivered_where") {
    return t(`delivered.${value}` as "delivered.remote") || value;
  }
  return value;
}
