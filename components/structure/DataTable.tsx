"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { Checkbox } from "@/components/primitives";
import { ChevronDown, Dots } from "@/components/primitives/icons";
import { Pagination } from "./Pagination";

/**
 * The work surface. Two of the three surfaces in this product live inside it,
 * so the rules below are not preferences.
 *
 *  · real <table>, <thead>, <th scope> — the design canvas draws tables with
 *    divs for layout reasons; the build must not
 *  · mono uppercase column heads on --paper-sunk
 *  · hairline row dividers, no vertical rules, no zebra striping
 *  · numbers right-aligned with tabular figures, so columns compare by eye
 *  · row tint carries meaning: selected, attention, blocked. Nothing decorative
 *  · one visible row action, the rest behind a three-dot menu
 *  · sortable heads carry a visible arrow, not a hover-only hint
 *  · indeterminate select-all
 *  · pagination above 50 rows, and never infinite scroll
 */
export type RowTone = "default" | "selected" | "attention" | "blocked";
export type SortDirection = "asc" | "desc";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => React.ReactNode;
  /** Right-aligned with tabular figures. Every number column, always. */
  numeric?: boolean;
  /** Machine strings — SKU, ref, licence number. */
  mono?: boolean;
  sortable?: boolean;
  width?: string;
  /** Dropped below this width rather than squeezed. */
  hideBelow?: "sm" | "md" | "lg";
}

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface DataTableProps<Row> {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Required. A table with no name is unusable without sight of it. */
  caption: string;

  selectable?: boolean;
  selected?: readonly string[];
  onSelectedChange?: (keys: string[]) => void;
  selectAllLabel?: string;
  selectRowLabel?: (row: Row) => string;

  sort?: { key: string; direction: SortDirection };
  onSortChange?: (sort: { key: string; direction: SortDirection }) => void;
  sortLabel?: (header: string, direction: SortDirection) => string;

  /** The one action that stays visible on every row. */
  rowAction?: (row: Row) => { label: string; onSelect: () => void } | null;
  /** Everything else, behind the three dots. */
  rowMenu?: (row: Row) => RowMenuItem[];
  /** Per row, so the trigger names what it acts on rather than saying "menu". */
  rowMenuLabel?: (row: Row) => string;
  /** Accessible name for the actions column head. */
  actionsHeader?: string;
  /** Meaning only. A tone that decorates is a tone that stops meaning anything. */
  rowTone?: (row: Row) => RowTone;
  onRowClick?: (row: Row) => void;

  loading?: boolean;
  loadingRows?: number;
  /** Rendered in place of the body when there are no rows. */
  empty?: React.ReactNode;

  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    rangeLabel: (from: number, to: number, total: number) => string;
    previousLabel: string;
    nextLabel: string;
    pageLabel: (page: number) => string;
  };
}

const TONE: Record<RowTone, string> = {
  default: "bg-card",
  // Selection is a moss tint plus a moss edge. Never a shadow.
  selected: "bg-moss-wash",
  attention: "bg-warn-surface",
  blocked: "bg-bad-surface",
};

const TONE_EDGE: Record<RowTone, string> = {
  default: "before:bg-transparent",
  selected: "before:bg-moss",
  attention: "before:bg-warn",
  blocked: "before:bg-bad",
};

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  selectable = false,
  selected = [],
  onSelectedChange,
  selectAllLabel,
  selectRowLabel,
  sort,
  onSortChange,
  sortLabel,
  rowAction,
  rowMenu,
  rowMenuLabel,
  actionsHeader,
  rowTone,
  onRowClick,
  loading = false,
  loadingRows = 6,
  empty,
  pagination,
}: DataTableProps<Row>) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allKeys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const allSelected = rows.length > 0 && allKeys.every((k) => selectedSet.has(k));
  const someSelected = !allSelected && allKeys.some((k) => selectedSet.has(k));

  const hasActions = Boolean(rowAction || rowMenu);
  const columnCount = columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  const cellPad = "px-3";
  const rowHeight = { height: "var(--row-h, 46px)" };

  return (
    <div className="overflow-hidden rounded-b-card border border-t-0 border-line bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>

          <thead>
            <tr className="bg-paper-sunk">
              {selectable && (
                <th scope="col" className={cn(cellPad, "w-10 py-2")}>
                  <Checkbox
                    aria-label={selectAllLabel}
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => onSelectedChange?.(allSelected ? [] : allKeys)}
                  />
                </th>
              )}

              {columns.map((column) => {
                const active = sort?.key === column.key;
                const direction: SortDirection = active && sort ? sort.direction : "asc";
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      cellPad,
                      "py-2 font-mono text-colhead font-medium uppercase text-muted",
                      column.numeric && "text-right",
                      column.hideBelow && HIDE[column.hideBelow],
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        aria-label={sortLabel?.(column.header, active && direction === "asc" ? "desc" : "asc")}
                        onClick={() =>
                          onSortChange({
                            key: column.key,
                            direction: active && direction === "asc" ? "desc" : "asc",
                          })
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-tag",
                          "transition-colors duration-120 ease-out hover:text-ink",
                          "focus-visible:outline-none focus-visible:shadow-focus",
                          column.numeric && "flex-row-reverse",
                          active && "text-ink",
                        )}
                      >
                        {column.header}
                        {/* Visible, not hover-only: a sort you cannot see is a
                            sort you will not trust. */}
                        <ChevronDown
                          size={11}
                          className={cn(
                            active ? "text-moss" : "text-faint",
                            active && direction === "asc" && "rotate-180",
                          )}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}

              {hasActions && (
                <th scope="col" className={cn(cellPad, "w-24 py-2")}>
                  <span className="sr-only">{actionsHeader}</span>
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {loading &&
              Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`skeleton-${i}`} className="border-t border-line" style={rowHeight}>
                  <td colSpan={columnCount} className={cn(cellPad, "py-2")}>
                    <span className="block h-3 w-full max-w-[32rem] rounded-tag bg-track motion-safe:animate-pulse" />
                  </td>
                </tr>
              ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-3 py-10">
                  {empty}
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row) => {
                const key = rowKey(row);
                const isSelected = selectedSet.has(key);
                const tone: RowTone = isSelected ? "selected" : (rowTone?.(row) ?? "default");
                const action = rowAction?.(row) ?? null;
                const menu = rowMenu?.(row) ?? [];

                return (
                  <tr
                    key={key}
                    style={rowHeight}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "relative border-t border-line",
                      // The tone edge is a 2px bar on the leading edge, drawn
                      // with a pseudo-element so it does not add a column.
                      "before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:content-['']",
                      TONE[tone],
                      TONE_EDGE[tone],
                      "transition-colors duration-120 ease-out",
                      onRowClick && "cursor-pointer",
                      tone === "default" && "hover:bg-paper-sunk",
                    )}
                  >
                    {selectable && (
                      <td className={cn(cellPad, "py-1.5")} onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={selectRowLabel?.(row)}
                          checked={isSelected}
                          onChange={() =>
                            onSelectedChange?.(
                              isSelected ? selected.filter((k) => k !== key) : [...selected, key],
                            )
                          }
                        />
                      </td>
                    )}

                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          cellPad,
                          "py-1.5 text-body-sm text-body",
                          column.numeric && "text-right tabular-nums",
                          column.mono && "font-mono",
                          column.hideBelow && HIDE[column.hideBelow],
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}

                    {hasActions && (
                      <td className={cn(cellPad, "py-1.5 text-right")} onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center justify-end gap-1">
                          {action && (
                            <button
                              type="button"
                              onClick={action.onSelect}
                              className={cn(
                                "rounded-ctl border border-line bg-card px-2 py-1 text-caption text-body",
                                "transition-colors duration-120 ease-out",
                                "hover:border-line-strong hover:text-ink",
                                "focus-visible:outline-none focus-visible:shadow-focus",
                              )}
                            >
                              {action.label}
                            </button>
                          )}
                          {menu.length > 0 && rowMenuLabel && (
                            <RowMenu label={rowMenuLabel(row)} items={menu} />
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {pagination && <Pagination {...pagination} />}
    </div>
  );
}

function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  // A disclosure, not a menu widget. role="menu" without arrow-key navigation
  // and type-ahead promises a screen reader something this does not do, and the
  // promise is worse than the plain truth. The summary is the control, so the
  // name goes on the summary — a nested button inside it would be a second
  // control that the platform does not activate.
  return (
    <details className="relative inline-block">
      <summary
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-ctl",
          "border border-transparent text-muted",
          "transition-colors duration-120 ease-out",
          "hover:bg-fill hover:text-ink",
          "focus-visible:outline-none focus-visible:shadow-focus",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <Dots size={14} />
      </summary>
      <div
        className={cn(
          "absolute end-0 z-20 mt-1 min-w-44 overflow-hidden rounded-card border border-line bg-card",
          "text-left shadow-overlay",
        )}
      >
        {items.map((item, i) => (
          <div key={item.key}>
            {item.destructive && i > 0 && <div className="h-px bg-line" role="none" />}
            <button
              type="button"
              disabled={item.disabled}
              onClick={item.onSelect}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-body-sm",
                "transition-colors duration-120 ease-out",
                "focus-visible:outline-none focus-visible:bg-fill",
                "disabled:cursor-not-allowed disabled:text-disabled-text",
                item.destructive ? "text-bad-ink hover:bg-bad-wash" : "text-body hover:bg-fill",
              )}
            >
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
