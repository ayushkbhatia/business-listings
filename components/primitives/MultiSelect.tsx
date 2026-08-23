"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Check, ChevronDown, Close, Search } from "./icons";
import { CONTROL_TEXT, type ControlSize } from "./field-shell";

/**
 * Several values from a list. Custom, because no platform multi-select is worth
 * putting in front of a buyer.
 *
 * Selected values render as removable chips inside the control, so the answer
 * is visible without opening anything — a filter rail that hides its own state
 * is how people end up with zero results and no idea why.
 *
 * Filtering appears past a threshold. Six certifications do not need a search
 * box; forty areas do.
 */
export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Accessible name for the control. */
  label: string;
  placeholder?: string;
  /** Placeholder for the filter box, shown once the list is long. */
  filterPlaceholder?: string;
  /** `{n} selected`, already localised. */
  summaryLabel?: (count: number) => string;
  /** Accessible name for a chip's remove button, already localised. */
  removeLabel?: (option: string) => string;
  emptyLabel?: string;
  size?: ControlSize;
  invalid?: boolean;
  disabled?: boolean;
  /** Chips collapse to a count past this many. */
  maxChips?: number;
  filterThreshold?: number;
}

export function MultiSelect({
  options,
  value,
  onChange,
  label,
  placeholder,
  filterPlaceholder,
  summaryLabel,
  removeLabel,
  emptyLabel,
  size = "md",
  invalid = false,
  disabled = false,
  maxChips = 3,
  filterThreshold = 8,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = useMemo(() => new Set(value), [value]);
  const showFilter = options.length >= filterThreshold;

  const visible = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDocument = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(optionValue: string) {
    onChange(
      selected.has(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue],
    );
  }

  const chips = options.filter((o) => selected.has(o.value));
  const overflow = Math.max(0, chips.length - maxChips);

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-ctl border bg-card py-1 pl-2 pr-8 text-left",
          "min-h-9",
          "transition-colors duration-120 ease-out",
          "focus-visible:outline-none focus-visible:shadow-focus",
          CONTROL_TEXT[size],
          invalid ? "border-bad-line-strong" : "border-line-strong",
          disabled && "cursor-not-allowed border-line bg-fill text-disabled-text",
        )}
      >
        {chips.length === 0 ? (
          <span className={disabled ? "text-disabled-text" : "text-faint"}>{placeholder}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {chips.slice(0, maxChips).map((chip) => (
              <span
                key={chip.value}
                className={cn(
                  "inline-flex items-center gap-1 rounded-chip border-[1.5px] border-moss",
                  "bg-moss-wash px-1.5 py-0.5 text-caption text-moss-deep",
                )}
              >
                {chip.label}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={removeLabel?.(chip.label) ?? chip.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!disabled) toggle(chip.value);
                  }}
                  className="cursor-pointer text-moss hover:text-moss-hover"
                >
                  <Close size={11} />
                </span>
              </span>
            ))}
            {overflow > 0 && (
              <span className="font-mono text-eyebrow text-muted">
                {summaryLabel ? summaryLabel(overflow) : `+${overflow}`}
              </span>
            )}
          </span>
        )}
        <ChevronDown
          size={14}
          className={cn(
            "absolute right-2.5 top-1/2 -translate-y-1/2",
            disabled ? "text-disabled-text" : "text-muted",
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden",
            "rounded-card border border-line bg-card shadow-overlay",
          )}
        >
          {showFilter && (
            <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
              <Search size={13} className="shrink-0 text-faint" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={filterPlaceholder}
                className="w-full bg-transparent text-body-sm text-ink outline-none placeholder:text-faint"
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && (
              <li className="px-3 py-2 text-caption text-muted">{emptyLabel}</li>
            )}
            {visible.map((option) => {
              const isSelected = selected.has(option.value);
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onClick={() => toggle(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm",
                      "transition-colors duration-120 ease-out",
                      "focus-visible:outline-none focus-visible:bg-fill",
                      "disabled:cursor-not-allowed disabled:text-disabled-text",
                      isSelected ? "text-ink" : "text-body",
                      "hover:bg-fill",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-tag border",
                        isSelected ? "border-moss bg-moss text-on-ink" : "border-line-strong bg-card",
                      )}
                    >
                      {isSelected && <Check size={11} />}
                    </span>
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
