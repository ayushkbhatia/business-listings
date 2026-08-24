"use client";

import { cn } from "@/lib/cn";
import { Close } from "@/components/primitives/icons";

/**
 * An applied filter, above the results. Removable, always.
 *
 * The chip row is the answer to "why am I seeing so few results", so a filter
 * that is applied but not shown here is a filter the buyer will not think to
 * remove. Every applied facet gets a chip, including the ones set from a URL
 * they arrived on.
 */
export interface FilterChipProps {
  /** The facet, e.g. "Emirate". Reads as "Emirate: Dubai". */
  facet?: string;
  children: React.ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  /** No remove control — for a facet fixed by the route, like the category. */
  fixed?: boolean;
}

export function FilterChip({ facet, children, onRemove, removeLabel, fixed = false }: FilterChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border-[1.5px] whitespace-nowrap",
        "py-0.5 ps-2 text-caption",
        fixed ? "border-line-strong bg-fill pe-2 text-body" : "border-moss bg-moss-wash pe-1 text-moss-deep",
      )}
    >
      {facet && <span className="text-muted">{facet}:</span>}
      {children}
      {!fixed && onRemove && removeLabel && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={onRemove}
          className={cn(
            "flex size-4 items-center justify-center rounded-tag text-moss",
            "transition-colors duration-120 ease-out hover:bg-card hover:text-moss-hover",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <Close size={11} />
        </button>
      )}
    </span>
  );
}
