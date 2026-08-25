"use client";

import { cn } from "@/lib/cn";
import { ChevronDown } from "@/components/primitives/icons";
import { formatCount } from "@/lib/format";

/**
 * Page controls for a work surface.
 *
 * Never infinite scroll here. A seller working an enquiry inbox needs to know
 * how much is left, to be able to come back to page 3, and to be able to reach
 * the footer. Infinite scroll takes all three away.
 *
 * Below the threshold the whole thing is hidden — a table of nine rows with
 * page controls under it looks broken.
 */
export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Renders "1–50 of 218", already localised. */
  rangeLabel: (from: number, to: number, total: number) => string;
  previousLabel: string;
  nextLabel: string;
  pageLabel: (page: number) => string;
  /** Hidden entirely at or below this many rows. The design system says 50. */
  threshold?: number;
  /**
   * Page sizes staff may choose between.
   *
   * Offering a size at all is what keeps "just show me everything" from being a
   * reasonable request — a console over 41,000 listings has no honest
   * all-rows view, and the way to say so is to name the sizes that exist.
   */
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;
  /** Names the select. Required whenever options are offered. */
  pageSizeLabel?: string;
}

function pageWindow(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push("gap");
  for (let p = from; p <= to; p += 1) out.push(p);
  if (to < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  rangeLabel,
  previousLabel,
  nextLabel,
  pageLabel,
  threshold = 50,
  pageSizeOptions,
  onPageSizeChange,
  pageSizeLabel,
}: PaginationProps) {
  if (total <= threshold) return null;

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const step = cn(
    "inline-flex size-8 items-center justify-center rounded-ctl border border-line bg-card text-muted",
    "transition-colors duration-120 ease-out",
    "hover:border-line-strong hover:text-ink",
    "focus-visible:outline-none focus-visible:shadow-focus",
    "disabled:cursor-not-allowed disabled:border-line disabled:bg-fill disabled:text-disabled-text",
  );

  return (
    <nav
      aria-label={pageLabel(page)}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2"
    >
      <div className="flex items-center gap-3">
        <p className="font-mono text-eyebrow tabular-nums text-muted">
          {rangeLabel(from, to, total)}
        </p>

        {pageSizeOptions && onPageSizeChange && pageSizeLabel && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">{pageSizeLabel}</span>
            {/*
              A native select. The design system's own note on Select applies
              here more than anywhere: this is a control somebody uses once and
              then forgets, and the platform one is the one their browser
              already knows how to open.
            */}
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className={cn(
                "h-8 rounded-ctl border border-line bg-card px-2",
                "font-mono text-eyebrow tabular-nums text-muted",
                "transition-colors duration-120 ease-out",
                "hover:border-line-strong hover:text-ink",
                "focus-visible:outline-none focus-visible:shadow-focus",
              )}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {formatCount(size)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={previousLabel}
          title={previousLabel}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={step}
        >
          <ChevronDown size={14} className="rotate-90" />
        </button>

        {pageWindow(page, pages).map((entry, i) =>
          entry === "gap" ? (
            <span key={`gap-${i}`} aria-hidden="true" className="px-1 font-mono text-eyebrow text-faint">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              aria-label={pageLabel(entry)}
              aria-current={entry === page ? "page" : undefined}
              onClick={() => onPageChange(entry)}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center rounded-ctl px-2",
                "font-mono text-caption tabular-nums",
                "transition-colors duration-120 ease-out",
                "focus-visible:outline-none focus-visible:shadow-focus",
                entry === page
                  ? "border-[1.5px] border-moss bg-moss-wash text-moss-deep"
                  : "border border-line bg-card text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {formatCount(entry)}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label={nextLabel}
          title={nextLabel}
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          className={step}
        >
          <ChevronDown size={14} className="-rotate-90" />
        </button>
      </div>
    </nav>
  );
}
