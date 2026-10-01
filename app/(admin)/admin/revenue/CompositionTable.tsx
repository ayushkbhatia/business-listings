import { cn } from "@/lib/cn";
import type { CompositionRow } from "./composition";

/**
 * MRR, taken apart: each plan at list price, the subtotal list price × plan mix
 * gives, what annual terms and any other price take off it, and the ledger's
 * figure the lines add up to. D-MRR, board 4a.
 *
 * A real table, two columns, because the reader's job is to add the right-hand
 * column down and arrive at the last row — `4g` and `4a` print the same rows.
 */
export function CompositionTable({ rows, caption }: { rows: readonly CompositionRow[]; caption: string }) {
  return (
    <table className="mt-4 w-full border-collapse text-body-sm">
      <caption className="pb-2 text-start font-mono text-eyebrow uppercase text-body">{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            className={cn(
              (row.role === "subtotal" || row.role === "total") && "border-t border-line",
              row.role === "total" && "font-medium text-ink",
            )}
          >
            <th
              scope="row"
              className={cn(
                "py-1 pe-3 text-start align-top font-normal",
                row.role === "line" ? "ps-3 text-body" : "text-ink",
                row.role === "total" && "font-medium",
              )}
            >
              {row.label}
            </th>
            <td className="whitespace-nowrap py-1 ps-2 text-end align-top tabular-nums text-ink">{row.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
