"use client";

import { cn } from "@/lib/cn";
import { Close } from "@/components/primitives/icons";
import { IconButton } from "@/components/primitives";

/**
 * Replaces the toolbar while rows are selected. It does not sit beside it —
 * two bars stacked is how a user loses track of which controls act on what.
 *
 * Destructive actions sit at the end and are separated, so "Delete 24
 * businesses" is never adjacent to "Export".
 */
export interface SelectionAction {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface SelectionBarProps {
  count: number;
  /** "24 selected", already localised and pluralised. */
  countLabel: (count: number) => string;
  actions: SelectionAction[];
  onClear: () => void;
  clearLabel: string;
}

export function SelectionBar({ count, countLabel, actions, onClear, clearLabel }: SelectionBarProps) {
  const ordinary = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);

  return (
    <div
      // Assertive would interrupt; the count changes as fast as the user clicks.
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-t-card border-[1.5px] border-moss bg-moss-wash",
        "px-3 py-2",
      )}
      style={{ minHeight: "var(--row-h, 46px)" }}
    >
      <span className="font-mono text-caption tabular-nums text-moss-deep">{countLabel(count)}</span>

      <span className="mx-1 h-4 w-px bg-moss-muted" aria-hidden="true" />

      {ordinary.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={action.disabled}
          onClick={action.onSelect}
          className={cn(
            "rounded-ctl border border-transparent px-2.5 py-1 text-caption text-moss-deep",
            "transition-colors duration-120 ease-out",
            "hover:border-moss-muted hover:bg-card",
            "focus-visible:outline-none focus-visible:shadow-focus",
            "disabled:cursor-not-allowed disabled:text-disabled-text",
          )}
        >
          {action.label}
        </button>
      ))}

      {destructive.length > 0 && (
        <>
          <span className="mx-1 h-4 w-px bg-moss-muted" aria-hidden="true" />
          {destructive.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={action.disabled}
              onClick={action.onSelect}
              className={cn(
                "rounded-ctl border border-transparent px-2.5 py-1 text-caption text-bad-ink",
                "transition-colors duration-120 ease-out",
                "hover:border-bad-line-strong hover:bg-bad-surface",
                "focus-visible:outline-none focus-visible:shadow-focus-danger",
                "disabled:cursor-not-allowed disabled:text-disabled-text",
              )}
            >
              {action.label}
            </button>
          ))}
        </>
      )}

      <span className="ml-auto">
        <IconButton size="sm" label={clearLabel} icon={<Close size={13} />} onClick={onClear} />
      </span>
    </div>
  );
}
