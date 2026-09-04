"use client";

import { cn } from "@/lib/cn";

/**
 * A small set of mutually exclusive options, all visible. Two to five; past
 * that it is a Select.
 *
 * Implemented as a radiogroup rather than a row of buttons, so arrow keys move
 * between options and a screen reader announces "2 of 3". The selected segment
 * carries the design system's selection treatment — a moss border and a
 * moss-tinted fill, never a shadow.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Required: the group needs a name for anyone not looking at it. */
  label: string;
  size?: "sm" | "md";
  block?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  block = false,
}: SegmentedControlProps<T>) {
  const enabled = options.filter((o) => !o.disabled);

  /**
   * Move the selection **and the focus**.
   *
   * In a radiogroup the two travel together: WAI's pattern is that an arrow key
   * checks the next radio and focuses it, and the roving `tabIndex` below is
   * only half of that. Without the focus call the selection moved while the
   * ring stayed on the segment the reader had left — so the visible focus was
   * on one option and the checked one was another, and the next Tab left the
   * group from the wrong place. Found by the keyboard pass on board 1l's
   * monthly/annual toggle; it was wrong on every SegmentedControl in the
   * product.
   *
   * The buttons are read off the group element rather than held in refs. The
   * DOM query filters disabled exactly as `enabled` does, in the same order, so
   * one index addresses both.
   */
  function move(direction: 1 | -1, group: HTMLElement) {
    const index = enabled.findIndex((o) => o.value === value);
    const nextIndex = (index + direction + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (!next) return;
    onChange(next.value);
    group
      .querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')
      [nextIndex]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex rounded-ctl border border-line bg-paper-sunk p-0.5",
        block && "flex w-full",
      )}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1, event.currentTarget);
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1, event.currentTarget);
        }
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: the group is one tab stop, arrows move inside it.
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-chip font-medium",
              "transition-colors duration-120 ease-out",
              "focus-visible:outline-none focus-visible:shadow-focus",
              "disabled:cursor-not-allowed disabled:text-disabled-text",
              block && "flex-1",
              size === "sm" ? "h-7 px-2.5 text-caption" : "h-8 px-3 text-body-sm",
              selected
                ? "border-[1.5px] border-moss bg-moss-wash text-moss-deep"
                : "border-[1.5px] border-transparent text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
