import { cn } from "@/lib/cn";

/**
 * RoleMatrix — board 4i's "Role permissions".
 *
 * A real table: capabilities are row headers, roles are column headers, and a
 * grant is a word as well as a mark. A tick alone is colour-and-symbol
 * shorthand; a screen reader hears "Granted" or "Not granted" in the cell,
 * and the column header it belongs to, which is what makes the matrix readable
 * without sight of it.
 *
 * The rows arrive from `staffMatrix()`, which reads `CAPABILITIES` — the table
 * `can()` decides from. This component draws; it never decides. Every string
 * arrives already translated.
 */

export interface RoleMatrixColumn {
  key: string;
  /** `OPS`. Mono, uppercase, and the column head. */
  short: string;
  /** `Ops lead`. The abbreviation's expansion, for the header's accessible name. */
  label: string;
}

export interface RoleMatrixRow {
  key: string;
  label: string;
  /** Keyed by column key. */
  grants: Readonly<Record<string, boolean>>;
  /** A short note beside the label — "reason required", "own rows only". */
  note?: string;
}

export interface RoleMatrixGroup {
  key: string;
  label: string;
  rows: readonly RoleMatrixRow[];
}

export interface RoleMatrixProps {
  caption: string;
  capabilityHeader: string;
  columns: readonly RoleMatrixColumn[];
  groups: readonly RoleMatrixGroup[];
  grantedLabel: string;
  deniedLabel: string;
  /** Highlights one column — the viewer's own role. */
  highlight?: string;
}

export function RoleMatrix({
  caption,
  capabilityHeader,
  columns,
  groups,
  grantedLabel,
  deniedLabel,
  highlight,
}: RoleMatrixProps) {
  return (
    <div tabIndex={0} className="overflow-x-auto focus-visible:shadow-focus focus-visible:outline-none">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-paper-sunk">
            <th scope="col" className="px-3 py-2 font-mono text-colhead font-medium uppercase text-muted">
              {capabilityHeader}
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "w-12 px-2 py-2 text-center font-mono text-colhead font-medium uppercase text-muted",
                  highlight === column.key && "text-ink",
                )}
              >
                <abbr title={column.label} aria-label={column.label} className="no-underline">
                  {column.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            <tr className="border-t border-line">
              <th
                scope="colgroup"
                colSpan={columns.length + 1}
                className="px-3 pb-1 pt-3 text-left font-mono text-eyebrow uppercase text-muted"
              >
                {group.label}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.key} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left align-top font-normal">
                  <span className="block text-body-sm text-ink">{row.label}</span>
                  {row.note ? <span className="block text-caption text-body">{row.note}</span> : null}
                </th>
                {columns.map((column) => {
                  const granted = row.grants[column.key] === true;
                  return (
                    <td
                      key={column.key}
                      className={cn(
                        "px-2 py-2 text-center align-top",
                        highlight === column.key && "bg-moss-wash",
                      )}
                    >
                      <span aria-hidden="true" className={granted ? "text-ok-ink" : "text-faint"}>
                        {granted ? "✓" : "—"}
                      </span>
                      <span className="sr-only">{granted ? grantedLabel : deniedLabel}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
