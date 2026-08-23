"use client";

import { cn } from "@/lib/cn";
import { SelectionBar, type SelectionAction } from "./SelectionBar";

/**
 * The bar above a table: search, filters, then actions on the right.
 *
 * The selection bar *replaces* this rather than stacking under it, and that
 * swap lives here rather than in every screen — a rule enforced in one place is
 * a rule that holds.
 */
export interface TableToolbarProps {
  /** Search field, filter chips — whatever narrows the set. */
  children?: React.ReactNode;
  /** Buttons that act on the whole table. Right-aligned. */
  actions?: React.ReactNode;
  /** When any row is selected this takes over the bar entirely. */
  selection?: {
    count: number;
    countLabel: (count: number) => string;
    actions: SelectionAction[];
    onClear: () => void;
    clearLabel: string;
  };
}

export function TableToolbar({ children, actions, selection }: TableToolbarProps) {
  if (selection && selection.count > 0) {
    return (
      <SelectionBar
        count={selection.count}
        countLabel={selection.countLabel}
        actions={selection.actions}
        onClear={selection.onClear}
        clearLabel={selection.clearLabel}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-t-card border border-line bg-card px-3 py-2",
      )}
      style={{ minHeight: "var(--row-h, 46px)" }}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
