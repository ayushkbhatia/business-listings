import { cn } from "@/lib/cn";

/**
 * The plans side by side — a real table above 768px, per-plan blocks below it.
 *
 * Board 1l draws this as a five-row matrix under the cards, and two things
 * about it are load-bearing:
 *
 *   - It is a `<table>`, with `<caption>`, `<th scope="col">` on the plan names
 *     and `<th scope="row">` on the feature. The design canvas draws tables with
 *     divs for layout reasons and non-negotiable 4 says the build must not.
 *   - Below 768 it is **not** a table. A four-column table on a phone forces a
 *     horizontal scroll, and the column that goes off the right edge is the one
 *     being sold. So the narrow view is one block per plan, each block a
 *     definition list of the same rows, and only one of the two is in the
 *     accessibility tree at a time.
 *
 * Every cell arrives as an already-localised string. Nothing here formats a
 * number, decides what is included, or knows what a plan is — that is
 * `lib/billing/pricing.ts`, so the table cannot quietly grow an opinion about
 * the thing it is displaying.
 *
 * **A word, never a glyph alone.** An absent feature reads "Not included"
 * rather than an em dash in a paler colour. The accessibility floor rules out
 * colour as the only carrier, and a dash announced as "dash" tells a screen
 * reader user nothing about whether they are getting the feature.
 */

export interface PlanComparisonColumn {
  id: string;
  /** The plan's name, as the `Plan` row spells it. */
  name: string;
  /** The recommended plan's column, tinted. One at most. */
  highlighted?: boolean;
}

export type PlanComparisonState = "included" | "absent" | "value";

export interface PlanComparisonCell {
  planId: string;
  /** Already localised: "Included", "Not included", "1.35×". */
  label: string;
  state: PlanComparisonState;
}

export interface PlanComparisonRow {
  key: string;
  /** Already localised. */
  header: string;
  /**
   * The qualification, rendered under the row header rather than as a footnote
   * marker. A claim and the sentence that bounds it belong in the same place: a
   * footnote is a promise that the reader will scroll, and on the one row of
   * this page that is easy to overstate, they will not.
   */
  note?: string;
  cells: readonly PlanComparisonCell[];
}

export interface PlanComparisonProps {
  /** Required. A table with no name is unusable without sight of it. */
  caption: string;
  /** The head of the first column, e.g. "What else is different". */
  featureHeader: string;
  columns: readonly PlanComparisonColumn[];
  rows: readonly PlanComparisonRow[];
}

const CELL_INK: Record<PlanComparisonState, string> = {
  included: "text-ok-ink",
  // Not --text-faint, which measures 2.56:1 on paper against a 4.5:1 floor.
  absent: "text-muted",
  value: "text-ink",
};

export function PlanComparison({ caption, featureHeader, columns, rows }: PlanComparisonProps) {
  const cellOf = (row: PlanComparisonRow, planId: string) =>
    row.cells.find((cell) => cell.planId === planId);

  /*
     Nothing to compare renders nothing.

     The rows are built by dropping every dimension the plans answer the same
     way, so levelling the tiers in `/admin/plans` can legitimately empty this.
     A head with no body under a section called "what else is different" is the
     padded version of an honest answer, and the honest answer is that there is
     nothing else. The caller drops its heading on the same condition.
  */
  if (rows.length === 0) return null;

  return (
    <>
      {/* ≥768: the table. */}
      <div className="hidden overflow-hidden rounded-card border border-line bg-card md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-paper-sunk">
              <th
                scope="col"
                className="px-5 py-3 font-mono text-eyebrow uppercase font-medium text-muted"
              >
                {featureHeader}
              </th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(
                    "w-[150px] px-4 py-3 text-center font-mono text-eyebrow uppercase font-medium",
                    column.highlighted ? "bg-moss-wash text-moss-deep" : "text-muted",
                  )}
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-5 py-3 align-top font-normal">
                  <span className="block text-body-sm text-body">{row.header}</span>
                  {row.note && (
                    <span className="mt-1 block max-w-prose text-caption leading-relaxed text-muted">
                      {row.note}
                    </span>
                  )}
                </th>
                {columns.map((column) => {
                  const cell = cellOf(row, column.id);
                  return (
                    <td
                      key={column.id}
                      className={cn(
                        "px-4 py-3 text-center align-top text-body-sm",
                        column.highlighted && "bg-fill",
                        cell ? CELL_INK[cell.state] : "text-muted",
                        cell?.state === "value" && "tabular-nums",
                      )}
                    >
                      {cell?.label}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
         <768: one block per plan.

         Hidden rather than restacked, so exactly one of the two structures is
         in the accessibility tree — `display:none` takes the other out of it
         entirely, which is what keeps a screen reader from reading every row
         twice.
      */}
      <div className="flex flex-col gap-3 md:hidden">
        {columns.map((column) => (
          /*
             A div, not a labelled section.

             `<section aria-label="Pro">` is a landmark, and this component
             renders beside PlanCard, which already puts a landmark of that
             exact name on the page for the same plan. Two landmarks sharing a
             role and a name make a screen reader's landmark list a row of
             identical entries — `landmarks.spec.ts` fails on precisely that,
             and `display:none` does not save it because the check walks the
             DOM. The `dl` below carries all the structure this needs.
          */
          <div
            key={column.id}
            className={cn(
              "rounded-card border bg-card p-4",
              column.highlighted ? "border-moss" : "border-line",
            )}
          >
            <p
              className={cn(
                "font-mono text-eyebrow uppercase",
                column.highlighted ? "text-moss-deep" : "text-muted",
              )}
            >
              {column.name}
            </p>
            <dl className="mt-3 flex flex-col gap-3">
              {rows.map((row) => {
                const cell = cellOf(row, column.id);
                return (
                  /*
                     The note sits inside the `dt`, beside the thing it
                     qualifies — which is where the table puts it too, in the
                     `th scope="row"`. It was a `p` after the `dd` and axe was
                     right to refuse it: a `div` inside a `dl` may hold only a
                     dt/dd group, and the trailing paragraph broke the pairing.
                     Moving it also keeps the phone from dropping the sentence
                     that bounds the ranking claim, which is the one place it
                     must not be dropped.
                  */
                  <div key={row.key} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                    <dt className="text-body-sm text-body">
                      {row.header}
                      {row.note && (
                        <span className="mt-1 block text-caption leading-relaxed text-muted">
                          {row.note}
                        </span>
                      )}
                    </dt>
                    <dd
                      className={cn(
                        "mt-1 text-body-sm font-medium",
                        cell ? CELL_INK[cell.state] : "text-muted",
                        cell?.state === "value" && "tabular-nums",
                      )}
                    >
                      {cell?.label}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
