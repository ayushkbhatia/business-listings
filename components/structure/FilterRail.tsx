"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronDown } from "@/components/primitives/icons";

/**
 * The rail down the side of a category or results page.
 *
 * Generated from the category's filterable spec fields, so this component knows
 * nothing about valves — it renders whatever sections it is handed. Changing
 * `isFilterable` on a SpecField changes the rail with no code change, which is
 * handoff 1 acceptance criterion 4.
 *
 * Every section shows how many of its options are active, and the applied
 * count sits at the top with one clear-all. A rail that hides its own state is
 * how a buyer ends up at zero results with no idea which filter did it.
 */
export interface FilterSection {
  key: string;
  label: string;
  /** How many options in this section are currently applied. */
  activeCount?: number;
  /** The controls. Checkboxes, a RangeSlider, a MultiSelect. */
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export interface FilterRailProps {
  sections: readonly FilterSection[];
  /** Required: several navs can share a page. */
  label: string;
  /** Total filters applied, across every section. */
  appliedCount: number;
  /** Already localised and pluralised. A string, not a formatter: a server
   * component cannot hand a function across the client boundary, and the
   * results page that uses this is server-rendered. */
  appliedLabel: string;
  clearAllLabel: string;
  /** Clear by navigation, for a server-rendered rail. */
  clearAllHref?: string;
  onClearAll?: () => void;
}

export function FilterRail({
  sections,
  label,
  appliedCount,
  appliedLabel,
  clearAllLabel,
  clearAllHref,
  onClearAll,
}: FilterRailProps) {
  const clearClasses = cn(
    "rounded-tag text-caption text-moss underline-offset-2",
    "transition-colors duration-120 ease-out hover:text-moss-hover hover:underline",
    "focus-visible:outline-none focus-visible:shadow-focus",
  );
  return (
    <aside aria-label={label} className="w-full">
      {/*
        The rail's own heading. Its sections are h3, and without this they sit
        directly under the page h1 — a skipped level, and an outline that reads
        as ten unrelated sections rather than ten filters.
      */}
      <h2 className="sr-only">{label}</h2>
      {appliedCount > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-line py-2">
          <span aria-live="polite" className="font-mono text-eyebrow tabular-nums text-muted">
            {appliedLabel}
          </span>
          {clearAllHref ? (
            <a href={clearAllHref} className={clearClasses}>
              {clearAllLabel}
            </a>
          ) : (
            <button type="button" onClick={onClearAll} className={clearClasses}>
              {clearAllLabel}
            </button>
          )}
        </div>
      )}

      {sections.map((section) => (
        <FilterSectionBlock key={section.key} section={section} />
      ))}
    </aside>
  );
}

function FilterSectionBlock({ section }: { section: FilterSection }) {
  const [open, setOpen] = useState(section.defaultOpen ?? true);
  const active = section.activeCount ?? 0;

  return (
    <div className="border-b border-line">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex w-full items-center gap-2 py-2.5 text-left",
            "transition-colors duration-120 ease-out",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <span className="text-body-sm text-ink">{section.label}</span>
          {active > 0 && (
            <span className="rounded-pill bg-moss-wash px-1.5 py-px font-mono text-eyebrow tabular-nums text-moss-deep">
              {active}
            </span>
          )}
          <ChevronDown
            size={13}
            className={cn("ms-auto text-muted transition-transform duration-120 ease-out", open && "rotate-180")}
          />
        </button>
      </h3>
      {open && <div className="flex flex-col gap-2 pb-3">{section.children}</div>}
    </div>
  );
}
