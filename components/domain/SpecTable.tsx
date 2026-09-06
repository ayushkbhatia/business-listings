import { cn } from "@/lib/cn";

/**
 * The category's spec template, filled in for one product.
 *
 * The template drives the rows, not the data — so a field the seller has not
 * filled still appears, faint, saying "Not provided". Dropping it would let a
 * thin listing look complete, and the whole point of a spec table on a trade
 * directory is that a buyer can see what is missing before they enquire.
 *
 * Real table markup with a scope on every head. The design canvas draws these
 * with divs for layout reasons; the build must not.
 */
export interface SpecRow {
  key: string;
  label: string;
  /** Already formatted — formatSize for a diameter, plain text otherwise. */
  value?: string | null;
  /** The unit, where the template names one. */
  unit?: string | null;
  /** This field drives a site-wide filter. Marked so a seller knows it matters. */
  filterable?: boolean;
  /** Machine strings. */
  mono?: boolean;
}

export interface SpecTableProps {
  rows: readonly SpecRow[];
  /** Required: names the table. */
  caption: string;
  /** Shown in an unfilled row, already localised. */
  notProvidedLabel: string;
  /** Marks a filterable field, already localised. */
  filterableLabel?: string;
  /** Alternating row tint. */
  striped?: boolean;
}

export function SpecTable({
  rows,
  caption,
  notProvidedLabel,
  filterableLabel,
  striped = true,
}: SpecTableProps) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {rows.map((row, i) => {
            const empty = row.value === undefined || row.value === null || row.value === "";
            return (
              <tr
                key={row.key}
                className={cn("border-b border-line last:border-b-0", striped && i % 2 === 1 && "bg-paper-sunk")}
              >
                <th
                  scope="row"
                  className="w-2/5 px-3 py-2 align-top text-caption font-normal text-muted"
                >
                  <span className="flex flex-wrap items-baseline gap-1.5">
                    {row.label}
                    {row.filterable && filterableLabel && (
                      <span className="font-mono text-eyebrow uppercase text-faint">
                        {filterableLabel}
                      </span>
                    )}
                  </span>
                </th>
                <td
                  className={cn(
                    "px-3 py-2 align-top text-body-sm",
                    row.mono && "font-mono",
                    /*
                       Muted, not faint.

                       An unfilled row is the one whose entire content is an
                       admission of a gap, and it was rendered in the least
                       legible tone on the page: `--text-faint` measures 2.56:1
                       on paper and 2.70:1 on card, both under the 4.5:1 floor.
                       Two components already refuse it by name for the same
                       reason (ChipLink, Eyebrow).

                       Board 3g's handoff asked for the row to be dropped
                       instead. It stays — "unfilled data stays visible" is a
                       project rule and board 1g's own criterion — but the
                       complaint underneath it was legible and correct, so the
                       tone moves. The seller reads exactly this table in the
                       editor's preview rail.
                    */
                    empty ? "text-muted" : "text-body",
                  )}
                >
                  {empty ? (
                    notProvidedLabel
                  ) : (
                    <>
                      {row.value}
                      {row.unit && <span className="ms-1 text-muted">{row.unit}</span>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
